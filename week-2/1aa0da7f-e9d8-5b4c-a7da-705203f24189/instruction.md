# Ashgrove Custody Works Wardline

Wardline is a digital evidence custody and disclosure system for public-interest investigations units of 5 to 50 people: oversight bodies, ombudsman offices and human-rights documentation teams. It gives them need-to-know compartments, sealed exhibits, burned-in redaction, separated release sign-off and a hash-chained ledger that an auditor can verify in their own browser without trusting the server. It uses PostgreSQL for records and the ledger, MinIO for file bytes, and a Mailpit SMTP relay for notices. Out of scope: self-registration, password reset, account administration beyond the seeded people, payments, any extra datastore, video exhibits, and redaction of audio.

## Problem and users

Small investigations units hold whistleblower files, witness recordings and leaked records whose authenticity will be attacked and whose exposure can hurt people. To be relied on, this material needs a record of who handled it and proof that it has not changed since collection. Most units cannot afford police-grade evidence suites, so they use shared drives with thin access records and ad hoc transfers that create uncontrolled copies. Black-box overlays keep failing in public too, because covered text can be copied straight out of a published PDF. The unit pays three times: in staff hours rebuilding custody histories by hand, in challenges to its evidence, and in harm to sources when a release or a badly scoped link exposes too much.

| Role | Goal | Frequency |
|---|---|---|
| Intake officer | Register each exhibit with its provenance into the right compartment, and clear or refuse another officer's quarantined uploads | Daily |
| Case lead | Grant, scope and revoke compartment access, place legal holds, propose or confirm disposal, read an exhibit's custody history, and sign off or reject releases assembled by someone else | Daily |
| Investigator | Work exhibits inside a compartment, mark redactions and assemble release packages | Daily |
| Outside counsel | Open a scoped read-only link and collect only the signed-off material for one matter | Occasional |
| Requester | Collect a signed-off disclosure through a link without an account and without seeing anything else | Occasional |
| Auditor | Independently verify the hash-chained ledger, read any exhibit's custody history, and review denials, break-glass use and suspicious-activity signals | Weekly |

## Journeys

1. **Registering an exhibit.** An intake officer is signed in on the intake route with a file and its provenance to hand. They choose the compartment, fill in the provenance, choose the file and register it. They watch and hear real upload progress, then a storage confirmation, then see a new exhibit in the quarantine list with its full digest and a closed link mark. If the connection drops before an answer comes, everything stays in the form and one more press finishes the job without creating a second exhibit. If their session ends while the form is filled, they sign in again where they are and the registration finishes with nothing retyped.
2. **Clearing quarantine.** A second intake officer signs in with quarantined exhibits waiting in a shared compartment. They read each one's provenance and digest, press Clear and complete step-up. The server re-reads the stored file against its seal. The exhibit shows as cleared and leaves the quarantine list, the compartment's quarantine count falls for anyone watching, and keyboard focus moves on to the next row. If the stored file no longer matches, the exhibit stays quarantined and the auditor sees a signal.
3. **Controlling access.** A case lead has a compartment open and an investigator is reading an exhibit in another browser. The lead narrows, revokes or lets lapse that investigator's grant and completes step-up. The access list updates in place without disturbing anything else on the lead's page. The investigator's open page loses what they may no longer see, and shows the access-changed or access-ended notice. A compartment's last case lead cannot be removed.
4. **Redacting.** An investigator starts on a cleared exhibit's page, at a desk or on a phone. They add regions by pointer, touch or keyboard, or mark every match of a searched word, save them and render a derivative. The derivative appears with its own digest, and the covered content is gone from its bytes, wherever the original's rotation or crop placed it.
5. **Releasing.** An investigator creates a release, adds current derivatives and submits it with step-up. A case lead who did not contribute watches it join the review queue, opens the release, opens every item, signs off with step-up, and lands on the release's detail route showing Signed off. The sign-off applies only to the contents that lead saw. The assembler receives a decision notice by mail. The lead then shares the release and sees its link.
6. **Collecting through a link.** Outside counsel or a requester opens a share link with no account. They see only that release's derivatives, collect each one, and see a confirmation that its digest matched. Once the link is revoked or lapses, the same address shows the unavailable page.
7. **Break-glass, hold and disposal.** A case lead with no grant on a compartment enters its reference and a written reason, then completes step-up. They gain access with a visible end time set by the server, and the owner receives a notice. They can place a legal hold under a matter, but cannot propose, confirm or cancel a disposal, or decide or share a release. After the fixed period, access ends by itself on every open page. Separately, a case lead with a normal grant proposes disposing of a cleared exhibit and a second case lead confirms it; every stored copy goes while the record and digests stay. A hold placed during the proposal cancels it.
8. **Proving the ledger and reading custody.** An auditor signs in and lands on the ledger route with the walk head at the start. They move the head by keyboard, touch or scroll. Their browser recomputes each digest, the digest cells settle, and link marks close with Verified while the verified-through numeral climbs. They copy an anchor and keep it elsewhere. If a row was altered below the application, or a later visit's anchor shows the history was rewritten, the walk stops at that link with the break state. They open the chain lattice, orbit it, and see the same verdict with the fault drawn in vermilion from the broken link onwards. They then enter an exhibit id and read its custody history entry by entry, each entry checked in their browser. A case lead scrubs the same history as a timeline on the exhibit's page.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in refusal and lockout.** Refuse a failed sign-in with the same status, body, wording and comparable response time whether or not the account exists, and lock an identity after repeated failures for the period stated in Business rules.
- **DP-02 — Role landing routes.** Land each role on its published route after sign-in, and keep that screen on reload and on opening that address directly.
- **DP-03 — Session revocation.** Fail a revoked or signed-out session on its very next request.
- **DP-04 — Safe return after sign-in.** Return a person whose session ended to the published route they were on, and fall back to their landing route for any off-site, disguised or role-inappropriate address.
- **DP-05 — Idle expiry ignores background checks.** End a session at the published idle moment without a non-background request, never count the page's own automatic checks as activity, and write its closing entry within the published delay.
- **DP-06 — Sign-in sheet measures.** Give the sign-in screen the published figure-to-label ratio, faces, colours, rules and absence of shadow listed for it under Measured values.
- **DP-07 — Step-up proof.** Require a fresh password-and-code proof for every privileged action, bound to one session and consumed by one action.
- **DP-08 — Exhibit registration.** Let an intake officer register a file with its provenance into a granted compartment and see it sealed, with its full digest, in quarantine.
- **DP-09 — Upload refusal by content.** Judge an upload by its sniffed bytes and refuse a type mismatch, an unaccepted type, an unsafe file name or an oversize file.
- **DP-10 — All-or-nothing sealed registration.** Commit the stored object, database row and seal entry together or leave none of them, and report an exhibit as sealed only after storage confirms the object's size and digest.
- **DP-11 — Byte-identical originals.** Keep every sealed original byte-identical to the submission, including metadata that redaction removes from derivatives.
- **DP-12 — Registration replay and retry.** Replay or refuse a repeated registration key as stated in Business rules, keep every value and the file after a connection lost before an answer, and let one more press reuse the key without creating a second exhibit.
- **DP-13 — Intake announcements.** Show upload progress from the bytes actually sent, announce the published thresholds, storage confirmation, seal completion and refusals in the named live region, and keep an error summary linking to each field until the next submit.
- **DP-14 — Resume after a session ends.** Keep a page's unsaved work through an in-place sign-in when its session ends, resend a refused registration or marks save once with the same key or version, and never reuse a proof from the old session.
- **DP-15 — Intake sheet measures.** Give the intake screen the published figure-to-label ratio, rule widths, progress bar thickness and refusal colour listed for it under Measured values.
- **DP-16 — Second-officer clearance.** Let only an intake officer who did not register an exhibit clear or refuse it.
- **DP-17 — Quarantine lock.** Block preview, redaction, packaging and collection of an exhibit for every role until it is cleared.
- **DP-18 — Attachment-only delivery.** Send every file as an attachment with content sniffing disabled, and never inline.
- **DP-19 — Single-use download grants.** Let exactly one of any number of concurrent requests claim a download grant, leave the grant unused if storage cannot open the object, and leave it spent once storage has opened it.
- **DP-20 — Seal re-check at clearance.** Re-read the stored original with no transaction or lock held before clearing, and on a mismatch keep the exhibit quarantined and the proof unused while durably recording one ledger entry and one signal.
- **DP-21 — Focus survives a vanished row.** Move keyboard focus to the published fallback when a quarantine row disappears, whoever caused it, and tell an officer who lost the race.
- **DP-22 — Quarantine measures.** Give the quarantine list the published rule widths, seal mark colour, mono digest and failed-seal colour listed for it under Measured values.
- **DP-23 — Compartment grants.** Let a case lead create compartments and issue, scope, edit and revoke access, with a derivatives-only scope that never reaches an original.
- **DP-24 — Serialised grant writes.** Serialise grant writes per compartment so that a stale write loses and a revocation always holds, apart from the published refusal to remove a compartment's last case lead.
- **DP-25 — A compartment keeps a case lead.** Refuse any revoke, narrowing or lapse that would leave a compartment with no case lead holding an active, full, non-lapsing grant, and check the actor's own authority again after taking the compartment lock.
- **DP-26 — Grant changes on any open page.** Stop a revoked member's very next read, and follow a grant's end or narrowing on every open compartment page within the delay stated in Feedback states, closing open dialogs when the grant ends and removing what the person may no longer see.
- **DP-27 — Live compartment view without repaint.** Update the access list, quarantine count and release byte total in place within the delay stated in Feedback states, keeping unchanged rows, focus and scroll position, and keep a grant dialog's typed values through a stale refusal so a second Save succeeds.
- **DP-28 — Docket pane layout.** Show three panes at 1200 pixels and wider, two from 768 to 1199 pixels and one below 768 pixels, at the published widths with no horizontal overflow at 375 pixels, and move between them on a live resize or rotation with no reload.
- **DP-29 — Closed compartment drawer.** Make a closed compartment drawer hidden and inert, with its links outside the tab order and the accessibility tree.
- **DP-30 — Server-decided grant lapse.** Accept, refuse, display and end a grant's lapse time only from the server's clock and in UTC, with no validation or formatting from the browser's clock or time zone.
- **DP-31 — Access list measures.** Give the compartment docket the published row rules, absence of shadow, top bar colour and mono identifiers listed for it under Measured values.
- **DP-32 — Out-of-grant refusal.** Answer any id outside the caller's grants as not found, nested, body and malformed ids included, and write the denial to the ledger in the same transaction, as qualified in Business rules.
- **DP-33 — Derived surfaces stay inside grants.** Keep every number and name in search, compartment counts and dashboard totals inside the caller's active grants.
- **DP-34 — Role-restricted actions.** Refuse role-restricted actions on the server for lower roles, even with a well-formed request.
- **DP-35 — Attributed ledger entries.** Write ledger entries attributed to an actor and session for every state change and for each denial, with the published encoded targets, as qualified in Business rules.
- **DP-36 — Ledger write protection.** Make update, delete and truncate of the ledger fail for the application login, through database privileges and triggers.
- **DP-37 — Malformed input stays plain.** Answer malformed ids, bodies and unstorable characters with a plain not-found or validation response and no server error or internal detail.
- **DP-38 — Not-found and search measures.** Give the not-found page and the compartments screen the published figure-to-label ratio, faces, rule widths and absence of vermilion listed for them under Measured values.
- **DP-39 — Redaction marks and superseded derivatives.** Let an investigator mark regions on a cleared exhibit's preview, save them as a versioned set with a stale save refused, render a derivative, and refuse to add, submit, sign off, share or regenerate with a derivative superseded by newer marks.
- **DP-40 — Burned-in, exact derivative files.** Render each derivative on the server as a new rasterised file with its own digest and marks burned in, holding only the published structures and byte-identical on every render from the same original and saved marks, as qualified in Business rules.
- **DP-41 — Canvas-only previews.** Fetch previews as blobs through single-use grants and draw them to a canvas, never inline.
- **DP-42 — Keyboard redaction.** Let a keyboard user add, move, resize and remove regions with the published keys, with each change announced.
- **DP-43 — Touch redaction and unsaved marks.** Let a touch user draw and adjust regions without scrolling the page, with 44 pixel hit areas and stable coordinates, and refuse to render while marks are unsaved.
- **DP-44 — Redaction follows the displayed page.** Measure regions on the page as displayed, honouring image orientation, PDF rotation and crop, visible annotations and filled form fields, and round every fill outward so no covered pixel survives.
- **DP-45 — Bounded rendering.** Seal oversized and password-protected files as submitted, refuse to preview or render them, and keep other requests answering during a render, as qualified in Business rules.
- **DP-46 — Mark text matches.** Return displayed-page regions rounded outward for a searched text, ignore text outside the visible area, save nothing by itself, and never store the searched text.
- **DP-47 — Newest preview page and lasting working marks.** Paint only the newest requested preview page after rapid page turns, and keep working regions and any drag in progress through page turns, checks, refreshes and another person's save.
- **DP-48 — Redaction measures.** Give the exhibit screen the published figure-to-label ratio, region outline, absence of shadow on the canvas and absence of vermilion on working regions listed for it under Measured values.
- **DP-49 — Release assembly.** Let a member assemble a release from current derivatives of its own compartment only and submit it for sign-off.
- **DP-50 — Release state machine with one winner.** Allow only the published release transitions, refuse every other one with the published conflict, and let exactly one of any number of concurrent decisions win with one ledger entry and one notice.
- **DP-51 — Separated sign-off.** Refuse sign-off or rejection by anyone who assembled the release, added an item to it, rendered an added derivative or saved its marks, for every role.
- **DP-52 — Release decision notice.** Queue a decision notice to the assembler in the same transaction as the decision, with no exhibit names, reasons or file content.
- **DP-53 — Keyboard-complete dialogs that survive refreshes.** Keep Tab and Shift+Tab inside every open dialog, close it on Escape with focus returned to its opener or the published fallback, and keep the step-up dialog, typed text, focus and error message through session checks and live refreshes, with the exceptions stated in Interactions.
- **DP-54 — Sign-off landing.** Land a case lead on the release's detail route after sign-off, showing its new state on reload.
- **DP-55 — Sign-off bound to the manifest.** Accept a sign-off only for the manifest digest the reviewer's dialog captured when it opened, leaving the proof unused on a mismatch.
- **DP-56 — Reviewer opens every item.** Refuse a sign-off until that same person has a committed download claim for every current item's derivative, leaving the proof unused, and show each item's Opened mark in place.
- **DP-57 — Live review queue.** Add and remove review queue rows and update its waiting count in place within the delay stated in Feedback states, keeping unchanged rows and moving focus to the published fallback when a focused row leaves.
- **DP-58 — Release measures.** Give the release and review queue screens the published figure-to-label ratio, row rules, Opened mark colour and refusal colour listed for them under Measured values.
- **DP-59 — Confirmed share.** Mark a signed-off release as shared only after every derivative is confirmed present in storage and none is superseded.
- **DP-60 — Link lifecycle.** Let a case lead revoke and regenerate a share link, answer unknown, revoked, lapsed and withdrawn tokens identically, and send the published privacy headers on every link response.
- **DP-61 — Link scope.** Show a link holder only that release's signed-off derivatives, without an account, and let the link change nothing.
- **DP-62 — Collection throttle.** Throttle bulk collection through a link at the published rate and raise a signal on the auditor's view.
- **DP-63 — Download tokens die with their authority.** Answer an unclaimed token as not found once the issuer's session, grant, scope, exhibit or link no longer supports it.
- **DP-64 — Stalled transfers hold nothing.** Stream bytes outside any transaction, keep other requests answering during stalled transfers, and release an abandoned transfer's resources within the time stated in Server boundary.
- **DP-65 — Capability hygiene and verified collection.** Store tokens, session values and proofs only as digests, and save a collected file only after its digest is checked in the browser, as qualified in Feedback states.
- **DP-66 — Link page measures.** Give the link collection screen the published figure-to-label ratio, single column, faces, digest-match colour and absence of a top bar listed for it under Measured values.
- **DP-67 — Break-glass opening and server-decided expiry.** Let a case lead open break-glass on a compartment outside their grants with a written reason, committing grant, ledger entry and notice together, show the server's end time in UTC, end access by the server's status whatever the browser's clock or time zone, and never reopen access by replaying the opening key.
- **DP-68 — Break-glass notice.** Send the compartment owner the actor, reason and compartment reference from the outbox, with line breaks in the reason flattened and no exhibit names, provenance or file content.
- **DP-69 — Break-glass limits and attribution.** Refuse decisions, sharing, link actions, withdrawal and disposal actions under break-glass as stated in Business rules, and name the grant on every entry made under it.
- **DP-70 — Auditor review.** Show the auditor denials, break-glass use with its action count, role grants and suspicious-activity signals, with every ledger row attributed to an actor and session.
- **DP-71 — Break-glass and review measures.** Give the auditor review tables and the break-glass time notice the published row rules, mono values and colours listed for them under Measured values.
- **DP-72 — Overlapping legal holds.** Let a case lead place a hold under a named matter with a written reason on a cleared, proposed or already held exhibit, lift each hold by its id, and keep the exhibit held until the last is lifted, one hold per matter, serialised per exhibit.
- **DP-73 — Two-lead disposal.** Require a proposal and a confirmation by two different case leads, block disposal of a held exhibit and of an exhibit in a live release, and cancel a proposal when a hold is placed so that a confirmation losing to a hold deletes nothing.
- **DP-74 — Disposal removes every copy.** Remove the original, every derivative object and the saved marks on confirmation, confirmed in storage before commit, and keep the rows and digests.
- **DP-75 — Hold marker measures.** Draw the held marker in the exact published vermilion with its icon and word, and keep vermilion off every exhibit row that is not held, as listed under Measured values.
- **DP-76 — Storage outage.** During a storage outage show the published banner, refuse storage-dependent actions with the published copy, and keep everything else working.
- **DP-77 — Mail outage.** During a mail outage complete the action, hold its notice durably, show the published held copy and deliver the notice after the relay returns.
- **DP-78 — Recovery without restart.** Start with a dependency down, return to service without a restart when it comes back, and clear the banner by itself.
- **DP-79 — Form state survives outage notices.** Keep typed values, the chosen file, focus, open dialogs and action messages while outage banners appear and clear, so a retry needs one press.
- **DP-80 — Authenticated storage status.** Report storage as up only after an authenticated bucket check, so that wrong credentials behave as a storage outage with the published copy and never a server error.
- **DP-81 — Outage banner measures.** Give the outage banner the published colours, absence of vermilion and absence of shadow, and keep its appearance from moving focus, as listed under Measured values.
- **DP-82 — Single ledger chain.** Serialise ledger appends so the single chain never forks, across every running copy of the app, using the published canonical form with free text kept as typed after trimming.
- **DP-83 — Walk rail operation.** Drive the walk head by keyboard, touch and scroll, hashing each reached link in the browser and keeping the verified-through mark when the head moves back.
- **DP-84 — Digest settling, newest head position wins.** Settle the 64 digest cells for the link under the head left to right in the published grid, close the link mark with a check and the word Verified while the numeral counts up, and cancel any older settle when the head moves.
- **DP-85 — First-break finding.** Stop the walk at the first altered, mismatched or missing link or failed anchor, and show the published break state with matching data attributes.
- **DP-86 — Walk on touch and under reduced motion.** Give rail controls targets of at least 44 pixels on a phone, and under reduced motion show the same verdicts with whole digests and no settling.
- **DP-87 — Walk announcements.** Announce every single-step link result, and for a move of more than one link only the link where the head comes to rest, in the named live region, with or without motion.
- **DP-88 — Walk over a long chain.** Walk a chain longer than one ledger page within the time stated in Browser support and performance, finding breaks across page boundaries with a bounded number of link marks on the page.
- **DP-89 — Anchors kept outside the server.** Let the auditor copy an anchor and check one later, catching a fully recomputed or truncated history at the anchor's link, with the anchor never leaving the browser.
- **DP-90 — Chain lattice with two published paths.** Draw the ledger on the chain lattice route as one node per link and one edge per previous-digest link, in WebGL2 when a context is available and otherwise as the published still frame, with the same verdict, node count and fault drawing either way.
- **DP-91 — Lattice orbit.** Orbit the lattice by the published keys and pointer rates from the published start camera, stop idle rotation on any input and always under reduced motion, keep the backing store at the device's pixel ratio, and never send a digest to the server from this view.
- **DP-92 — Walk and lattice measures.** Give the Chain Walk and lattice screens the published figure-to-label ratio, cell geometry, exact fault and verified colours, canvas sizes and pane widths listed under Measured values.
- **DP-93 — Custody history reading.** Return an exhibit's and its derivatives' stored ledger entries unchanged and in order through a capped cursor with no entry skipped or repeated while the ledger grows, to the published roles, including after disposal.
- **DP-94 — Custody check in the browser.** Recompute each custody entry's digest in the browser from its previous digest using the published canonical form, and show Verified or Altered on each row with the published summary.
- **DP-95 — Scrubbed custody timeline.** Tie the exhibit's custody timeline to its scroll position in both directions with the published values and end states, make it fully keyboard operable, and show each end state at once under reduced motion with the same function.
- **DP-96 — Custody measures.** Give the custody table and timeline the published row rules, verdict colours, stop strengths and fill geometry listed under Measured values.
- **DP-97 — Run manifest, health and seed.** Install, build and serve from the run manifest, answer the health path, and apply schema and seed data idempotently on every start.
- **DP-98 — Server boundary and credentials.** Serve same-origin only, enforce the request limits, never serve source files or credentials, and read every service credential and address from the environment without hard-coding one or sending it to the browser.
- **DP-99 — Docket sheet look.** Present every screen as a ruled docket sheet with one oversized figure, mono identifiers, a carbon top bar on signed-in screens and vermilion only for refusals, holds and chain breaks.

## Frontend

### Screens and layout (DP-02, DP-28, DP-29, DP-54, DP-90, DP-92, DP-95, DP-99)

| Route | Screen | Shows |
|---|---|---|
| `/sign-in` | Sign in | Email and password form |
| `/compartments` | Compartments | Totals for the caller's grants, exhibit search, compartments list, break-glass entry for case leads |
| `/compartments/<id>` | Compartment docket | Exhibits, access list, totals, releases |
| `/exhibits/<id>` | Exhibit | Exhibit id as the large figure, full digest directly below it in mono, provenance, preview canvas, redaction regions, derivatives, state actions, custody timeline and custody table |
| `/releases/<id>` | Release | State, items, byte total, decision actions, link controls |
| `/reviews` | Review queue | Waiting count, and submitted releases in the case lead's compartments |
| `/intake` | Intake | Registration form and quarantine list |
| `/ledger` | Chain Walk | Rail, walk head, pinned digest panel, verified-through numeral, anchors |
| `/audit/chain` | Chain lattice | Orbitable lattice of the ledger, verdict, camera readout, link details |
| `/ledger/review` | Auditor review | Denials, break-glass use, role grants, signals, custody lookup |
| `/l/<token>` | Link collection | Release name, matter reference, items, collect buttons; no top-bar navigation |

Any other address, and any id the caller cannot reach, shows the not-found copy from Feedback states. `/ledger`, `/audit/chain` and `/ledger/review` show that copy to every signed-in role but the auditor.

**Docket routes** (`/compartments`, `/compartments/<id>`, `/exhibits/<id>`, `/releases/<id>`, `/reviews`, `/intake`):

- **1200 pixels and wider, including 1280x800:** three panes side by side, in this order: compartments navigation, docket, inspector. At 1280 pixels wide the navigation is 240 pixels, the docket 480 pixels, each within 2 pixels, and the inspector takes the rest.
- **768 to 1199 pixels, including 768x1024:** two panes, docket then inspector. At 768 pixels wide the docket is 308 pixels within 2 pixels and the inspector takes the rest. The compartments navigation moves into a drawer opened from the top bar.
- **Below 768 pixels, including 375x812:** one pane, chosen by the route as the table below shows, filling the width. The compartments navigation stays in the drawer.

A browser's own scrollbar may take width from the last pane only. The drawer is closed by default below 1200 pixels. No viewport scrolls sideways. The accessibility tree never holds more than one `navigation "Compartments"`.

The docket pane is `region "Docket"` and the inspector pane is `region "Inspector"`. A pane not shown at a given width is hidden and out of the accessibility tree.

| Route | `region "Docket"` holds | `region "Inspector"` holds | Pane shown below 768 pixels |
|---|---|---|---|
| `/compartments` | Totals, search, compartments list, break-glass entry | The no-record copy from Feedback states | Docket |
| `/compartments/<id>` | That compartment's docket | The no-record copy | Docket |
| `/reviews` | Review queue | The no-record copy | Docket |
| `/intake` | Registration form and quarantine list | The no-record copy | Docket |
| `/exhibits/<id>` | The docket of the exhibit's compartment | The exhibit | Inspector |
| `/releases/<id>` | The docket of the release's compartment | The release | Inspector |

Choosing a row link goes to that record's route at every width, so the address changes, and reloading or opening that address shows the same screen. At 768 pixels and wider, the docket stays beside the inspector. Below 768 pixels, the inspector replaces the docket and `button "Back to docket"` appears at its top, which goes to `/compartments/<id>` for the record's compartment.

A caller with a derivatives-scoped grant sees no provenance, preview, `group "Redaction regions"` or `button "Download original"` on the exhibit screen, and the page never asks the server for them.

**Custody on the exhibit screen.** `region "Custody timeline"` and `table "Custody history"` sit at the bottom of the exhibit in the inspector at every viewport, timeline first, and appear only for a caller the custody endpoint admits. The timeline's scrolling part is exactly 320 pixels tall at every viewport and fills the inspector's width.

**Chain Walk:** at 768 pixels and wider, the rail sits on the left and the digest panel stays pinned on the right while the page scrolls. The rail is 320 pixels wide at 1280 pixels and 240 pixels wide at 768 pixels, each within 2 pixels. Below 768 pixels the digest panel stays pinned at the top, filling the width, with the rail beneath it. The anchor controls sit in the digest panel's column on wider screens and below the panel on a phone.

**Chain lattice**, inside `region "Lattice"`:

| Viewport | Order | Lattice canvas size, in layout pixels |
|---|---|---|
| 1280x800 | Canvas on the left, then a side column 376 pixels wide holding verdict, camera readout and controls, with 24 pixel margins and a 24 pixel gutter | 832 wide by 560 tall |
| 768x1024 | Canvas, then verdict, camera readout and controls beneath it, with 24 pixel margins | 720 wide by 480 tall |
| 375x812 | Verdict first, then canvas, then camera readout and controls, with 16 pixel margins | 343 wide by 343 tall |

**Link collection:** one column at every viewport.

### Public screens and controls (DP-01, DP-08, DP-13, DP-14, DP-23, DP-26, DP-27, DP-29, DP-30, DP-39, DP-42, DP-43, DP-46, DP-53, DP-56, DP-57, DP-61, DP-67, DP-70, DP-72, DP-73, DP-83, DP-84, DP-85, DP-89, DP-90, DP-91, DP-93, DP-94, DP-95)

Only these are public; everything else is free. `<...>` placeholders are defined in Feedback states.

| Screen | Role and accessible name | Notes |
|---|---|---|
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Sign in | `alert` "Sign-in status" | Refusal copy |
| Any signed-in page with unsaved work | `dialog "Sign in again"` holding read-only `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `button "Leave page"`, `status "Sign-in again status"` | See Sign in again under Interactions |
| Top bar | `button "Compartments"` | Below 1200 pixels only; opens the drawer and carries its expanded state |
| Top bar | `button "Sign out"` | |
| Drawer | `navigation "Compartments"` | One link per compartment; also the permanent first pane at 1200 pixels and wider |
| Drawer | `button "Close compartments"` | Below 1200 pixels only |
| Docket routes | `region "Docket"`, `region "Inspector"` | Contents per route are in Screens and layout |
| Exhibit, Release | `button "Back to docket"` | Below 768 pixels only |
| Review queue | `status "Review queue count"` | Named live region for the waiting count |
| Review queue | `table "Review queue"`; per row `link "<release id>"` | The link opens `/releases/<id>`. The queue has no decision controls; `button "Sign off"` and `button "Reject"` live only on the Release screen |
| Every signed-in screen | `status "Action status"` | Named live region for actions. It stays visible and announced while a dialog is open |
| Every screen except sign-in | `alert "Service notice"` | Outage banners; absent when services are up |
| Compartments | `searchbox "Search exhibits"`, `list "Search results"` | Results update as the user types |
| Compartments | `region "Totals"` | Mono counts from the dashboard endpoint |
| Compartments | `button "New compartment"`, `dialog "New compartment"`, `textbox "Compartment name"`, `button "Create compartment"` | Case lead only |
| Compartments | `textbox "Compartment reference"`, `textbox "Break-glass reason"`, `button "Open break-glass"` | Case lead only. The reason field accepts several lines |
| Compartment docket | `table "Exhibits"`, `table "Access list"`, `table "Releases"` | Each row of `table "Exhibits"` holds `link "<exhibit id>"` and each row of `table "Releases"` holds `link "<release id>"`, opening that record's route; `table "Access list"` is shown to case leads with a full grant. A held exhibit's row holds the held marker |
| Compartment docket | `status "Compartment totals"` | Text from Feedback states; holds elements with `data-quarantine-count` and `data-release-bytes` |
| Compartment docket | `button "Issue grant"`, `dialog "Issue grant"`, `dialog "Edit grant"`, `combobox "Person"`, `combobox "Scope"`, `textbox "Lapses at"`, `button "Save grant"` | The edit dialog has no `combobox "Person"`. `textbox "Lapses at"` is a plain text field with no browser date picker, minimum or local comparison |
| Access list row | `button "Edit grant for <name>"`, `button "Revoke grant for <name>"`, `button "End sessions for <name>"` | Only on rows of active grants of kind `grant`. Every row shows the grant's lapse text from Feedback states and its API state word |
| Compartment docket | `button "New release"`, `dialog "New release"`, `textbox "Release name"`, `textbox "Matter reference"`, `combobox "Recipient"`, `button "Create release"` | |
| Compartment docket, Exhibit, Release | `status "Break-glass time"` | Only while the caller holds this compartment through break-glass |
| Compartment docket, Exhibit, Release | `alert "Access ended"` | Replaces the compartment's content when the caller's grant ends, and takes focus |
| Intake | `form "Register exhibit"`, `combobox "Compartment"`, `textbox "Exhibit name"`, `textbox "Source"`, `textbox "Collected by"`, `textbox "Collected on"`, `textbox "Capture notes"`, `combobox "Declared type"`, file input named `File`, `textbox "Submitted digest"`, `button "Register exhibit"` | |
| Intake | `progressbar "Upload progress"` | Present while an upload runs; minimum 0, maximum 100, value the percent of the request's bytes actually sent |
| Intake | `alert "There is a problem"` | Error summary; one link per field in error, moving focus to that field |
| Intake | `status "Intake status"` | Named live region for registration |
| Intake | `table "Quarantine"`; per row `link "<exhibit id>"`, `button "Clear <exhibit id>"`, `button "Refuse <exhibit id>"` | The link opens the exhibit's route. Lists quarantined exhibits in compartments where the caller holds an active full grant. A row with a failed seal check shows an icon and the words `Seal failed` |
| Exhibit | `img "Exhibit preview page <page>"` | The preview canvas |
| Exhibit | `button "Previous page"`, `button "Next page"` | |
| Exhibit | `group "Redaction regions"`, `button "Add region"`, `button "Region <n>"`, `button "Save marks"`, `button "Render derivative"` | |
| Exhibit | `textbox "Find text"`, `button "Mark matches"` | Same audience as the preview |
| Exhibit | Corner handle of each region, with `data-region-handle="<n>"` | Pointer and touch only; outside the tab order |
| Exhibit | `status "Redaction status"` | |
| Exhibit | `table "Derivatives"` per row `button "Download <derivative id>"`; `button "Download original"` | A superseded row shows an icon and the word `Superseded` |
| Exhibit | `textbox "Hold matter"`, `button "Place hold"`, one `button "Lift hold <matter>"` per active hold, `button "Dispose"`, `button "Confirm disposal"`, `button "Cancel disposal"` | Case lead with a full grant only, and only when legal for the caller and state. A held exhibit shows the held marker |
| Exhibit | `alert "Access changed"` | Shown when a full grant narrows to derivatives; takes no focus |
| Exhibit, Auditor review | `table "Custody history"` | One row per entry, in `seq` order, each showing a check and `Verified` or a cross and `Altered` |
| Exhibit, Auditor review | `status "Custody status"` | Named live region for the custody check |
| Exhibit | `region "Custody timeline"` | Carries `data-scrub-progress`, `data-scrub-position`, `data-scrub-total` and `data-scrub-state` |
| Exhibit | Element with `data-custody-scroller` inside the timeline | The part that scrolls |
| Exhibit | Elements with `data-scrub-track` and `data-scrub-fill` | The timeline's track and its fill |
| Exhibit | One element per entry with `data-custody-stop="<seq>"` and `data-stop-state` | |
| Exhibit | `slider "Custody scrub"` | Minimum 1, maximum the entry count, value the position; value text `Entry <position> of <total>` |
| Exhibit | `button "Entry details"`, `dialog "Custody entry"`, `button "Close entry"` | The dialog shows the current entry's stored fields in mono |
| Exhibit | `status "Custody timeline status"` | Named live region for the timeline |
| Release | `combobox "Derivative"`, `textbox "Item label"`, `button "Add item"`, `button "Remove <label>"`, `button "Submit release"`, `button "Sign off"`, `button "Reject"`, `button "Reopen"`, `button "Share"`, `textbox "Link lapses at"`, `button "Revoke link"`, `button "Regenerate link"`, `button "Withdraw"` | Shown only when legal for the caller and state |
| Release | `status "Release state"` | Its whole text is the state's display word from Feedback states; carries `data-manifest-digest` with the release's current manifest digest |
| Release | Item rows | A superseded item shows an icon and the word `Superseded`. For a case lead with a full normal grant on a submitted release, each row holds `button "Open <label>"`, and an item the caller has opened shows an icon and the word `Opened` |
| Release | `link "Share link"` | Its text and address are the full address of the link page. It appears after Share or Regenerate link succeeds and stays until the page is left; the token is not shown again after a reload |
| Any privileged action | `dialog "Step-up"`, `textbox "Reason"`, `textbox "Password"`, `textbox "Authenticator code"`, `button "Confirm"`, `button "Cancel"` | `textbox "Reason"` appears only for actions that need one, and accepts several lines |
| Any privileged action | `status "Step-up status"` | Inside the dialog |
| Chain Walk | `region "Chain Walk"` | Carries `data-verified-through` (highest verified link, 0 at start) and `data-link-state` (`idle`, `verified` or `broken`, for the link under the head) |
| Chain Walk | `link "Chain lattice"` | Opens `/audit/chain` |
| Chain Walk | `slider "Ledger walk"` | Minimum 0, maximum link count, value the head's link; value text `Link <n> of <count>` |
| Chain Walk | `region "Digest panel"` | Holds exactly 64 elements with `data-digest-cell`, one hex character each (or `-` for a missing link), and carries `data-digest-state` of `settling` or `settled`; a differing cell has `data-differs="true"`, the first also has `data-first-break="true"` |
| Chain Walk | `status "Walk result"` | Named live region for link results |
| Chain Walk | Link mark on the rail with `data-link-mark="<n>"` | Shows a check and `Verified`, or a cross and `Break`; shows neither before its link is reached. At most 300 are on the page at once, always including the head's |
| Chain Walk | Rail text `Break at link <n>` | Only after a break |
| Chain Walk | Read-only `textbox "Current anchor"`, `button "Copy anchor"` | Value `wardline-anchor:v1:<n>:<digest>` for the highest verified link. Empty, with the button disabled, while nothing is verified |
| Chain Walk | `textbox "Anchor to check"`, `button "Check anchor"` | |
| Chain Walk | `status "Anchor status"` | Named live region for anchors |
| Chain lattice | `region "Lattice"` | Carries the lattice attributes listed under Chain lattice in Interactions |
| Chain lattice | `application "Chain lattice"` | The focusable canvas |
| Chain lattice | `status "Lattice verdict"`, `status "Lattice camera"`, `status "Lattice path notice"` | Named live regions |
| Chain lattice | `button "Reset view"`, `button "Link details"`, `link "Chain Walk"` | The link opens `/ledger` |
| Chain lattice | `dialog "Link details"` holding `textbox "Link number"`, `button "Show link"`, `status "Link details status"`, `button "Close details"` | |
| Auditor review | `table "Denials"`, `table "Break-glass use"`, `table "Role grants"`, `table "Signals"` | Each row of `table "Break-glass use"` has `data-action-count`, the number of ledger entries whose `detail.grant_id` names that grant |
| Auditor review | `textbox "Exhibit id"`, `button "Show custody"` | Shows `table "Custody history"` and `status "Custody status"` for that exhibit |
| Link collection | `heading` with the recipient heading from Feedback states; `list "Release items"`; `button "Collect <label>"` | |
| Link collection | `status "Collection status"` | |
| Not found | `heading` with the not-found copy | |

**Combobox options.** Each option shows the visible text below and carries the value the API receives.

| Combobox | Visible option text | Carried value |
|---|---|---|
| `combobox "Compartment"` | The compartment's name, for each compartment where the caller holds an active full grant | Compartment id |
| `combobox "Declared type"` | `PDF document`, `PNG image`, `JPEG image`, `WAV audio`, `MPEG audio` | In the same order: `application/pdf`, `image/png`, `image/jpeg`, `audio/wav`, `audio/mpeg` |
| `combobox "Person"` | The person's name, for everyone in the directory | Person id |
| `combobox "Scope"` | `Full`, `Derivatives only` | In the same order: `full`, `derivatives` |
| `combobox "Recipient"` | `Outside counsel`, `Requester` | In the same order: `counsel`, `requester` |
| `combobox "Derivative"` | The derivative's id, for each derivative in the release's compartment that is not disposed, superseded ones included | Derivative id |

### Interactions (DP-12, DP-13, DP-14, DP-21, DP-26, DP-27, DP-28, DP-30, DP-42, DP-43, DP-46, DP-47, DP-53, DP-55, DP-56, DP-57, DP-79, DP-83, DP-84, DP-85, DP-87, DP-88, DP-89, DP-90, DP-91, DP-94, DP-95)

**Step-up.** A privileged control opens the step-up dialog with focus on the first empty field. Tab and Shift+Tab wrap inside the dialog. Enter in a field submits. Escape or Cancel closes it without acting and returns focus to the opener. Confirm requests the proof and then sends the action, with the dialog still open. If step-up is refused, or the action refuses the dialog's `textbox "Reason"`, the dialog stays open, keeps the typed reason and clears only the password and code. Focus moves to `textbox "Password"` after a step-up refusal and to `textbox "Reason"` after a reason refusal. On any other answer the dialog closes and the action's own message appears in its region. Background checks never close the dialog, repaint it or take focus. There are exactly three exceptions: a session that has ended while neither the dialog nor the page behind it holds unsaved work, as Sign in again defines it, goes to sign-in; a session that has ended while either of them does opens Sign in again above the dialog; and a grant on this compartment that has ended closes every open dialog as described under Grant changes.

**Every dialog** follows the same Tab wrap, Escape and focus-return rules. When a dialog closes and its opener has gone, focus follows the Quarantine rule below if the opener was in that table, or the Review queue rule if it was in that table; otherwise it moves to the pane that held the opener, which takes focus programmatically.

**Sign-off.** `button "Sign off"` opens step-up and the dialog captures the manifest digest shown on the page at that moment. That captured value is what the sign-off sends, even if a live refresh has since changed `data-manifest-digest` behind the dialog.

**Opening items.** `button "Open <label>"` asks for a download grant on that item's derivative and claims it, so the file downloads while the page stays where it is. The `Opened` mark appears in that row in place once the release's `opened_by_caller` says so, within 5 seconds of the claim. A grant that was never claimed, or a claim storage rolled back, leaves no mark.

**Registration.**
- The form generates an `Idempotency-Key` for each registration attempt. The key stays the same until a field or the file is edited or a registration succeeds.
- Pressing `button "Register exhibit"` again, or pressing Enter, while a request is running sends nothing more.
- If the connection fails before an answer comes, status shows the lost-connection copy from Feedback states, and all values and the file stay in the form. Pressing the button again reuses the key.
- After a refused form, focus moves to `alert "There is a problem"`. The summary and field errors stay until the next submit, and leave on success.
- After success the form empties, apart from `combobox "Compartment"`, and the new exhibit appears in `table "Quarantine"`.
- A refusal during a storage outage keeps the values, the file and the message through every status check and banner change. Pressing the button once after storage returns registers the exhibit, with nothing retyped.

**Quarantine focus.** When a row leaves `table "Quarantine"`, focus moves to the next row's `button "Clear <exhibit id>"`, else the new last row's, else the table itself, which takes focus programmatically. The same fallback applies when a live refresh removes the row while its button has focus, and when the step-up dialog is cancelled or closed after its opener has gone.

**Review queue focus.** When a row leaves `table "Review queue"` while focus is in it, focus moves to the next row's link, else the new last row's, else the table itself, which takes focus programmatically.

**Grant dialogs.** An empty `textbox "Lapses at"` sends `expires_at` of null, meaning the grant does not lapse. `dialog "Edit grant"` prefills `textbox "Lapses at"` with the API's `expires_at` string unchanged. The browser never validates, compares or reformats a lapse time from its own clock or time zone; a time the server refuses shows the server's copy. A stale grant refusal closes the step-up dialog and leaves `dialog "Issue grant"` or `dialog "Edit grant"` open with its typed values and focus on `button "Save grant"`. The stale copy shows in `status "Action status"`, and the dialog adopts the current `access_version` from the refusal, so pressing `button "Save grant"` again goes through step-up and succeeds.

**Live refreshes.** A refresh keeps the same page elements for rows that did not change, and keeps focus and scroll position. Only rows that changed are replaced, and rows that left are removed. This holds for every live table, `table "Review queue"` and `table "Custody history"` included.

**Grant changes.** These apply on `/compartments/<id>`, `/exhibits/<id>` and `/releases/<id>` for a grant that ended by revocation, by lapse or as a break-glass grant ending.
- **Grant ended:** every open dialog closes, including step-up, and typed text in it is discarded. The compartment's content leaves the page as stated under Update delays. Focus moves to `alert "Access ended"`, and the page makes no further checks of that compartment.
- **Narrowed from full to derivatives:** the exhibit page removes provenance, the preview, `group "Redaction regions"`, `button "Download original"` and the custody surfaces, keeps `table "Derivatives"` and shows `alert "Access changed"`.
- **Widened:** nothing changes until the page is reloaded.

**Sessions and return.** A signed-in page with no unsaved work whose session has ended, and a signed-in route opened with no session, goes to `/sign-in?next=<percent-encoded path>`. Sign-out goes to plain `/sign-in`. The sign-in page shows the session-ended copy whenever `next` is in its address, sends `next` with the sign-in, and goes to the `landing` route in the response. A person already signed in who opens `/sign-in` goes to their landing route.

**Sign in again.** A session has ended by any cause while the page holds unsaved work. Unsaved work means an intake form with a typed value or chosen file, an exhibit page with unsaved regions, an open grant dialog, or a step-up dialog with a typed reason.
1. The page stays where it is, with no redirect, and opens `dialog "Sign in again"` within 10 seconds of the end, or at once on any `unauthenticated` answer.
2. `textbox "Email"` is read-only and holds the person's own address, and focus is on `textbox "Password"`. `status "Sign-in again status"` first reads the sign-in-again copy from Feedback states. Refusals use the existing sign-in copy there and count towards the same lockout.
3. Escape or `button "Leave page"` goes to `/sign-in?next=<path>`.
4. On success the dialog closes. Values, the chosen file and regions stay, and focus returns to the control that held it.
5. A registration or marks save that received the `unauthenticated` answer is resent once, automatically, with the same `Idempotency-Key` or `marks_version`, with no second press. Upload announcements restart for the new attempt, each threshold once.
6. An open step-up dialog keeps its typed reason, clears password and code, focuses `textbox "Password"` and sends nothing until Confirm. A proof from the old session is never reused.
7. If the grant ended during the gap, the Grant changes rule applies right after sign-in.

**Drawer.** `button "Compartments"` opens the drawer and moves focus to its first link. Escape or `button "Close compartments"` closes it and returns focus to the opener. While closed it is hidden and inert. Reopening it during its closing motion leaves it open.

**Live resizing.** Crossing 768 or 1200 pixels by resizing or rotating needs no reload, and the panes shown are the published ones for the new width. An open drawer closes and becomes inert when the width reaches 1200 pixels, and its links are then reachable only in the permanent first pane. If the focused control becomes hidden, focus moves to the pane now shown, which takes focus programmatically.

**Redaction.**
- `button "Add region"` adds a region on the current page, at x 100, y 100, w 200 and h 100, and focuses it. Units are thousandths of the displayed page's width and height.
- With a region focused, an arrow key moves it by 10 units. Shift plus an arrow key resizes it by 10 units from its right or bottom edge, never below 10 units. Delete or Backspace removes it and moves focus to `button "Add region"`.
- Pointer and touch users can drag on the canvas to draw a region, drag a region to move it, and drag its corner handle to resize it. A touch drag that starts on the canvas never scrolls the page.
- Each `button "Region <n>"` and its corner handle has a hit area of at least 44 pixels in both directions, even when the region is drawn smaller. A corner handle sits above its own region, and a newer region sits above an older one.
- A region's values stay the same in thousandths through changes of device pixel ratio, rotation and resize, and the region is redrawn over the same content.
- Each change announces the region's values in `status "Redaction status"`.
- Marks are working state only until `button "Save marks"` stores them. While the working regions differ from the saved ones, `button "Render derivative"` sends nothing and shows the unsaved-marks copy from Feedback states.
- A stale save keeps the working regions on screen and adopts the current `marks_version` from the refusal, so pressing `button "Save marks"` again saves them.
- `button "Mark matches"` sends `textbox "Find text"` to the find endpoint and adds each returned region as an unsaved working region, skipping any that exactly duplicates a working region. It saves nothing.

**Preview pages.** After any run of `button "Next page"` and `button "Previous page"` presses, only the newest requested page is ever painted. `img "Exhibit preview page <page>"`, the canvas and the regions shown all agree on that page. A grant or file that arrives late for an earlier request is dropped and never paints, and `Preview loaded.` is announced only for the page shown.

**Working regions.** They survive page turns, grant checks, live refreshes and another person's save. The working set changes only through the person's own edit, and the page's periodic checks never read saved regions over it. A drag in progress is not interrupted by a refresh.

**Search.** Results update as the user types, after a pause of no more than a third of a second, with no submit button.

**Chain Walk.**
1. The head sits at link 0 on arrival, with nothing verified, `data-link-state` of `idle`, `data-digest-state` of `settled` and the panel showing 64 `0` characters. No verdict, break included, appears until the head reaches that link.
2. Each 72 pixels of page scroll past the start of the rail moves the head one link, in both directions, from 0 to the link count. The rail's scroll range is the link count times 72 pixels, however long the chain and however few link marks are on the page.
3. With `slider "Ledger walk"` focused, Up and Right arrows move forward one link, Down and Left arrows move back one link, Page Up and Page Down move 10 links, Home goes to link 0, and End goes to the last reachable link.
4. Dragging the head by pointer or touch moves it. Moving by key or drag scrolls the page to match, and scrolling moves the slider value.
5. When the head reaches link N, the browser hashes every link up to N that it has not hashed yet, in order, using Web Crypto on the rules in the Single ledger chain rule, fetching further pages of `GET /api/ledger` with `after` set to the last `seq` it holds. It never takes a verdict from the server.
6. The digest panel then shows link N's computed digest, the link mark closes, and the numeral rises.
7. Moving the head back shows that earlier link's digest and leaves `data-verified-through` where it was.
8. New ledger entries extend the rail within 5 seconds, and the head stays where it is.
9. The browser remembers the highest verified link and its digest in its own storage. On a later visit the numeral still starts at 0, and the remembered value is tested only when the walk reaches it, under the Breaks rule in Business rules. The browser holds no digest for earlier links, so when only the remembered digest differs, the break names the remembered link.

**Newest head position.** Whenever the head moves, any settle still running is cancelled. The panel then works only on the link now under the head, and `data-digest-state` is `settled` only when all 64 cells show that link's digest. A late hash or a late cell timer never paints a digest from an earlier position.

**Announcements for the walk.** A single arrow step always announces its link. Any other move of more than one link (Page keys, Home, End, drag, scroll) announces only the link where the head comes to rest: a drag rests on release, and any other move rests once the head has stayed on one link for a quarter of a second and its hashing has finished. A break met on the way is where the head rests.

**On a break at link N** the head stops on N, even when a key, drag or scroll asked to go further, and cannot move past it. `data-verified-through` is N minus 1, and `data-link-state` is `broken` while the head is on N. Moving back still works: an earlier link shows its digest with no marked cells and `data-link-state` of `verified` (`idle` at link 0), the rail text stays, and returning to N restores the break state.

**Anchors.**
- `button "Copy anchor"` copies the value of `textbox "Current anchor"` to the clipboard. If the browser refuses, the field's text is selected instead.
- `button "Check anchor"` reads `textbox "Anchor to check"`, ignoring surrounding white space. A valid anchor is `wardline-anchor:v1:<n>:<digest>`, where `<n>` is a positive whole number with no leading zero and `<digest>` is 64 lower-case hex characters. Anything else shows the malformed copy and changes nothing.
- A valid anchor joins the remembered links in the Breaks rule. It is stored only in this browser, and no request ever carries it.
- **At or below `data-verified-through`:** it is tested at once. On a match, it shows the match copy. On a mismatch, the head moves onto that link, the break state shows, and `data-verified-through` becomes that link minus 1. This is the only way that value falls.
- **Above `data-verified-through`, within the chain:** it shows the accepted copy and is tested when the walk reaches it.
- **Beyond the chain's end:** it shows the accepted copy and follows the Breaks rule for a remembered link beyond the end. If the last link is already verified, that happens at once.

**Chain lattice.**

On arrival the browser reads every page of `GET /api/ledger`, computes every link under the Breaks rule, remembered links and anchors included, and draws the result. It takes no verdict from the server. Requests from this view carry only `after` and `limit`, and no digest ever goes to the server from it.

`region "Lattice"` carries these attributes, which a checker reads:

| Attribute | Value |
|---|---|
| `data-lattice-path` | `webgl2` while the lattice is drawn through a WebGL2 context, `still` while it is the still frame on a 2D canvas |
| `data-lattice-state` | `verifying`, `verified`, `broken`, or `unverified` when the browser has no Web Crypto |
| `data-node-count` | The ledger's link count: the number of rows, the API's `count` |
| `data-edge-count` | One fewer than the node count, and never below 0 |
| `data-broken-link` | The link the Breaks rule names, or empty |
| `data-fault-count` | Empty unless broken. Otherwise the link count minus (broken link minus 1), and never below 0 |
| `data-camera-yaw` | Degrees from 0 up to but not including 360, in steps of at most a tenth |
| `data-camera-pitch` | Degrees from −80 to 80 inclusive, in steps of at most a tenth |
| `data-idle` | `true` while idle rotation runs, otherwise `false` |

**Drawing.** Each link is one node at least 3 pixels across at a pixel ratio of 1, joined to the previous link's node by a straight edge. Nodes and edges are drawn flat, with no lighting or shading, on the paper colour, so each node's centre is exactly its colour from Measured values. A node is ink until verified, then deep green. The first broken link and every node after it, and the edges joining them, are vermilion, and vermilion appears nowhere else on the canvas. A chain with no break shows no vermilion. Every node stays inside the canvas at every camera angle.

**Paths.** If a WebGL2 context is available the lattice uses it. If none is available it draws one still frame on a 2D canvas, from the start camera, with the same colours and the same number of nodes, and shows the path notice from Feedback states. If a WebGL2 context is lost after drawing, the view changes to the still frame within one second, with the notice, and keeps its verdict and attributes. The verdict text is the same on either path. On the still frame, camera keys and drags change nothing.

**Camera, on the WebGL2 path.** The start camera is yaw 30 degrees and pitch 20 degrees.
- With `application "Chain lattice"` focused, Right adds 5 degrees of yaw, Left takes away 5, Up adds 5 degrees of pitch and Down takes away 5.
- Dragging by pointer or touch turns the camera by exactly half a degree per pixel: moving right adds yaw, moving down adds pitch. A touch drag on the canvas never scrolls the page, and dragging works with reduced motion too.
- Yaw wraps around, and pitch stops at its limits.
- `button "Reset view"` returns to the start camera.

**Idle rotation.** With motion allowed, the lattice turns on arrival at one turn every 40 to 60 seconds, by adding yaw, and `data-camera-yaw` updates at least once a second. Focusing the canvas, or any orbit input, stops it for good until the page is reloaded. Under reduced motion it never runs and `data-idle` is always `false`. From `button "Reset view"`, the same inputs land on the same camera with or without reduced motion.

**Shortcuts.** While focus is on any control in `region "Lattice"`, and not in a text field, `R` does the same as `button "Reset view"` and `D` does the same as `button "Link details"`. Neither fires with Ctrl, Alt or Meta held.

**Link details.** `dialog "Link details"` opens with `textbox "Link number"` prefilled with the broken link, or else the last link, and focused. Enter or `button "Show link"` shows the verdict for that number in `status "Link details status"`. Tab and Shift+Tab wrap, and Escape or `button "Close details"` closes it and returns focus to the opener.

**New entries** extend the lattice within 5 seconds. The camera, focus and any open dialog stay as they are, and the verdict is recomputed. `data-idle` does not change.

**Backing store.** On either path, the canvas's drawing buffer is its layout size times the device pixel ratio, rounded to the nearest whole number, within one pixel in each direction. It is corrected within a second of a resize or a change of pixel ratio.

**Custody check.** The browser reads every page of the custody endpoint and, for each row, recomputes the digest from that row's stored `prev_digest` using the canonical form and compares it with the row's stored `digest`. Each row then shows the verdict in its own place. New entries join within 5 seconds in place. The auditor's `button "Show custody"` replaces any earlier table.

**Custody timeline.** One stop per custody entry, in `seq` order.

| Value | Meaning |
|---|---|
| Scroll range of the `data-custody-scroller` element | Exactly (entry count minus 1) times 64 pixels, within one pixel |
| `data-scrub-total` | The entry count |
| `data-scrub-position` | The scroll offset divided by 64, rounded to the nearest whole number, plus 1 |
| `data-scrub-progress` | 1000 times the scroll offset divided by the scroll range, rounded to a whole number; 1000 when there is one entry |
| `data-scrub-state` | `moving` while the fill or a stop is still gliding, otherwise `settled` |
| `data-stop-state` | `past` before the position, `current` at it, `future` after it |

Every value follows scroll in both directions, never moving against it, so scrolling back reverses the timeline one stop at a time. The drawn length of `data-scrub-fill` as a share of `data-scrub-track` matches progress within 2 percent of the track once `data-scrub-state` is `settled`. A `past` or `current` stop is at full strength, and a `future` stop is at 40 percent strength, with the sheet showing through. The current stop has a heavy ink outline.

**End states.** At the top, position is 1, progress is 0, the fill is empty and every other stop is `future`. At the bottom, position equals the total, progress is 1000, the fill is full and every other stop is `past`. The timeline stops where the scroll stops and does not snap.

**Operation.**
- With `slider "Custody scrub"` focused, Up and Right go forward one stop, Down and Left go back one stop, Page Up and Page Down move 10 stops, Home goes to the first and End to the last. The scroller follows, and scrolling moves the slider.
- While focus is on any control in `region "Custody timeline"`, and not in a text field, `N` moves forward one stop and `P` moves back one stop. Neither fires with Ctrl, Alt or Meta held.
- `button "Entry details"` opens `dialog "Custody entry"` for the current stop. Tab and Shift+Tab wrap, and Escape or `button "Close entry"` closes it and returns focus to the opener.
- A stop whose entry fails the custody check shows the same cross and `Altered` as its table row.
- New entries extend the timeline within 5 seconds. Position and scroll offset stay, and the scroller never jumps.
- `status "Custody timeline status"` announces only the stop where the timeline comes to rest. A single key step always rests; any other move rests once it has held one stop for a quarter of a second.

**Collecting.** `button "Collect <label>"` asks for a collection grant, fetches the file to a blob, hashes it in the browser and compares it with the item's `sha256` before saving. On a mismatch nothing is saved. If the grant request answers `not_found`, the page's content is replaced by the not-found page, and the address stays the same.

### Visual design (DP-06, DP-15, DP-22, DP-31, DP-38, DP-48, DP-58, DP-66, DP-71, DP-75, DP-81, DP-92, DP-96, DP-99)

- **Colour:** the page is warm paper, with near-black ink for type and rules. A dark carbon bar runs across the top of every signed-in screen. Deep bottle green means verified. Vermilion appears only on refusals, holds and chain breaks, always with an icon and a word, so colour never carries meaning alone. Ordinary buttons are ink, not vermilion.
- **Type:** the display and identifier face is Martian Mono, a wide monospaced face. The body face is Instrument Sans, a compact, slightly narrow sans. Each step in the ordinary heading scale is about a quarter larger than the one below. Every identifier, digest, count and byte total is set in mono.
- **Composition:** each screen is a ruled docket sheet on a 12-column grid. Small mono labels sit against one very large figure, about ten times the label size, with wide empty margins around it. On a phone the figure shrinks to fit without sideways scrolling, and it stays the largest thing on the screen.
- **Density:** tables and lists are compact, with thin rules and no cards or shadows.
- **Sealed state:** every committed exhibit shows its full 64-character digest and a closed link mark.
- **Controls and contrast:** every interactive control is at least 44 pixels in both directions at 375 and 768 pixels wide. All text and controls meet WCAG 2.2 AA contrast, and focus is always visible as a heavy ink outline.
- **Fonts:** serve both typefaces from the app's own origin, as real web fonts loaded under the family names `Martian Mono` and `Instrument Sans`. Use Martian Mono at weights 400 and 700 and Instrument Sans at weights 400 and 600, all upright, and no other weight or style.

**Measured values.** These are exact, read from the browser's computed values, at a device pixel ratio of 1.

| Name | Value, on the usual 0 to 255 scale |
|---|---|
| Paper | red 241, green 238, blue 230 |
| Ink | red 20, green 20, blue 15 |
| Vermilion | red 200, green 50, blue 26 |
| Deep green | red 31, green 92, blue 69 |
| Carbon | red 35, green 35, blue 28 |

| Rule that applies to every screen | Value |
|---|---|
| Row rules in every table | Exactly 1 pixel thick along the bottom of each row, solid ink, and no rule on the row's other sides |
| Pane dividers | Exactly 1 pixel thick, solid ink |
| Drop shadows and glows | None on any element, dialogs and the open drawer included. A dialog is set off by a 2 pixel solid ink rule |
| Corners | Square on every control, table, dialog and panel |
| Top bar | Carbon, exactly 56 pixels tall, on signed-in screens only |
| Page ground | Paper |
| Ordinary button | Ink fill with paper text |
| Focus | A solid ink outline 3 pixels thick |
| Vermilion | Used by no text, fill or rule except a refusal message, a held marker, `Seal failed`, `Altered`, and a chain break's cells, mark, rail text and lattice nodes and edges |
| The one figure | Exactly one element per screen has `data-figure`, set in Martian Mono at weight 700. Its label has `data-figure-label`, set in Martian Mono at weight 400 |

| Viewport width | Figure size divided by label size |
|---|---|
| 1280 pixels | From 9 to 11 |
| 768 pixels | From 7 to 11 |
| 375 pixels | From 5 to 11 |

The figure always fits its pane with no sideways scrolling.

| Screen | The figure | Measures particular to it |
|---|---|---|
| `/sign-in` | The word `Wardline` | A refusal is vermilion with an icon; `button "Sign in"` is an ordinary button; body text is Instrument Sans |
| `/intake` | The caller's quarantine count | `progressbar "Upload progress"` is 2 to 6 pixels thick and ink on paper; error summary copy is vermilion with an icon |
| `table "Quarantine"` | | Each digest is the full 64 characters in Martian Mono; a closed link mark, with `data-seal-mark`, is deep green; `Seal failed` is vermilion with an icon |
| `/compartments` | The caller's total exhibits | `list "Search results"` uses no vermilion |
| `/compartments/<id>` | That compartment's exhibit count | `table "Exhibits"` and `table "Access list"` follow the row rules; lapse text and every id are in Martian Mono; a revoked or lapsed grant's row uses no vermilion |
| Not found | The text `404` | Heading in Instrument Sans at weight 600; no vermilion |
| `/exhibits/<id>` | The exhibit id | Working regions are drawn with a 2 pixel solid ink outline over the canvas and no vermilion; the canvas has no shadow; `Superseded` uses no vermilion |
| Held marker | | An element with `data-held-marker`, holding an icon and the word `Held`, whose text is exact vermilion. It is on every held exhibit's row and screen and on nothing else |
| `/releases/<id>` | The release's item count | The `Opened` mark is deep green with its icon; a refusal in `status "Action status"` is vermilion |
| `/reviews` | The waiting count | `table "Review queue"` follows the row rules; each release id is in Martian Mono |
| `/l/<token>` | The release's item count | One column; no carbon bar; the digest-match copy is deep green; the failed-digest copy is vermilion |
| `/ledger/review` | The open signals count | All four tables follow the row rules; ids and times are in Martian Mono; `status "Break-glass time"` is in Martian Mono wherever it appears, and is ink |
| `alert "Service notice"` | | Carbon fill with paper text; no vermilion and no shadow |
| `/ledger` | The verified-through numeral | Cells are equal in size, on a 1 pixel ink rule; a differing cell's fill is exact vermilion; the first has a 3 pixel ink outline; a closed link mark is deep green; no vermilion before a break |
| `/audit/chain` | The link count | The canvas sizes from Screens and layout; node colours as under Chain lattice; no shadow on the canvas |
| `table "Custody history"`, `region "Custody timeline"` | | Rows follow the row rules; `seq`, ids and times are in Martian Mono; `Verified` is deep green; `Altered` is vermilion; the fill is ink on a 1 pixel ink track; stop strengths as under Custody timeline |

### Motion and effects (DP-84, DP-86, DP-87, DP-43, DP-91, DP-95)

- **Press and hover:** controls respond in about a tenth of a second, with a change of tone and no bounce.
- **Panels and dialogs:** the drawer and dialogs enter and leave in about a quarter of a second, starting fast and settling gently.
- **Upload progress:** a thin ruled bar fills with real progress and never loops.
- **Signature, Chain Walk:** each time the head comes to a link, the 64 digest cells settle into the computed value from left to right. Each cell takes about a tenth of a second and starts a hair after its neighbour, so the whole digest finishes within half a second. The link mark closes with a check and the word Verified within about a third of a second, and the verified-through numeral counts up to its new value. The grid is 16 columns by 4 rows at 768 pixels and wider, and 8 by 8 below that. Moving the head back reverses step by step through the same digests, one link at a time, and the numeral stays where it is. A newer head position cuts off an older settle at once. On a break, the differing cells fill vermilion, the first gets a heavy outline, the mark opens with a cross and the word Break, and the rail text appears.
- **Chain lattice:** the WebGL2 lattice turns slowly on arrival at the idle rate published under Chain lattice, and this is the one permitted continuous motion. `button "Reset view"` glides the camera back in no more than a third of a second, starting fast and settling gently, and the camera attributes hold the final angles from the moment of the press. The still frame never moves.
- **Custody timeline:** as the scroll moves, the fill glides to its new length and each stop glides to its new strength, in a tenth to four tenths of a second, starting fast and settling gently, then landing exactly on the published values. `data-scrub-state` reads `moving` for that time, then `settled`. It reverses step by step on scrolling back.
- **No other loops:** nothing else moves unless it reports a state change. There are no ambient or looping animations other than the lattice's idle rotation.
- **Reduced motion:** every loop stops and each sequence shows its end state at once. Digests appear whole with no settling, and `data-digest-state` goes straight to `settled`. The numeral changes directly, and marks, panels and redaction region changes appear at once. The lattice has no idle rotation and its reset is immediate. The timeline's fill and stops change at once, and `data-scrub-state` is always `settled`. Hashing, verdict text, first-break marker, anchors, slider operation, orbit input, timeline values and live-region announcements stay identical.

### Feedback states (DP-13, DP-14, DP-20, DP-25, DP-26, DP-27, DP-30, DP-39, DP-46, DP-47, DP-53, DP-55, DP-56, DP-57, DP-62, DP-65, DP-67, DP-72, DP-73, DP-76, DP-77, DP-78, DP-79, DP-80, DP-85, DP-87, DP-89, DP-90, DP-91, DP-94, DP-95)

Placeholders:

- `<percent>` is 0, 25, 50, 75 or 100.
- `<exhibit id>`, `<derivative id>`, `<release id>` and `<compartment id>` are record ids in the seed data's format.
- `<n>` is a link or region number, or in the find copy the number of regions added, or in the custody copy the number of entries checked, or in the queue copy the number of submitted releases shown.
- `<count>` is the ledger's link count, or in the hold copy the number of holds still active, or in the unopened copy the number of items not yet opened.
- `<label>` is a release item's label.
- `<time>` is a UTC time as `HH:MM UTC`, from the hour and minute of the server's `ends_at`.
- `<seconds>` is the value of the throttle's wait.
- `<matter>` is a release's or hold's matter reference.
- `<quarantined>` is a compartment's quarantine count, and `<bytes>` is its release byte total, as plain digits.
- `<max>` is the field's maximum length from Validation limits in API, as plain digits with no separator.
- `<lapse>` is a grant's `expires_at` as `YYYY-MM-DD HH:MM`, taken from the API's string with no conversion.
- `<seq>` is a ledger entry's `seq`; `<position>` and `<total>` are the timeline's position and entry count.
- `<faulted>` is the lattice's `data-fault-count`.
- `<yaw>` and `<pitch>` are the camera's angles rounded to whole degrees.

Every message stays on screen until the user's next action, and no background refresh overwrites it. Each is shown visibly and announced through the region named here.

| Action | Region | Pending | Success | Outage |
|---|---|---|---|---|
| Register | `status "Intake status"` | `Uploading <percent> percent.`, then `Confirming storage.` | `Sealed <exhibit id>. In quarantine until a second officer clears it.` | `Not registered. Exhibit storage is unreachable, and nothing was kept. Try again when the notice clears.` |
| Clear | `status "Action status"` | `Clearing.` | `Cleared <exhibit id>.` | `Not cleared. Exhibit storage is unreachable.` |
| Refuse | `status "Action status"` | `Refusing.` | `Refused <exhibit id>.` | |
| Issue, edit grant | `status "Action status"` | `Saving grant.` | `Grant saved.` | |
| Revoke grant | `status "Action status"` | `Revoking.` | `Grant revoked.` | |
| End sessions | `status "Action status"` | `Ending sessions.` | `Sessions ended.` | |
| Place, lift hold | `status "Action status"` | `Saving hold.` | `Hold placed.` / `Hold lifted.` when no hold remains / `Hold lifted. Other holds remain: <count>.` | |
| Propose disposal | `status "Action status"` | `Proposing disposal.` | `Disposal proposed for <exhibit id>. Another case lead must confirm it.` | |
| Confirm disposal | `status "Action status"` | `Disposing.` | `Disposed <exhibit id>.` | `Not disposed. Exhibit storage is unreachable.` |
| Cancel disposal | `status "Action status"` | `Cancelling disposal.` | `Disposal cancelled.` | |
| Save marks | `status "Redaction status"` | `Saving marks.` | `Marks saved.` | |
| Find text | `status "Redaction status"` | `Finding matches.` | `Added <n> regions. Save your marks to keep them.` / `No matches found. A scanned page may still hold this text.` when there are none | `Find unavailable. Exhibit storage is unreachable.` |
| Render derivative | `status "Redaction status"` | `Rendering.` | `Rendered <derivative id>.` | `Not rendered. Exhibit storage is unreachable.` |
| Preview | `status "Redaction status"` | `Loading preview.` | `Preview loaded.` | `Preview unavailable. Exhibit storage is unreachable.` |
| Download, Open item | `status "Action status"` | `Preparing download.` | `Download started.` | `Download unavailable. Exhibit storage is unreachable. Your grant is still unused.` |
| Add, remove item | `status "Action status"` | `Saving item.` | `Item added.` / `Item removed.` | |
| Submit | `status "Action status"` | `Submitting.` | `Submitted <release id>.` | |
| Sign off | `status "Action status"` | `Signing off.` | `Signed off <release id>. Assembler notice queued.` | |
| Reject | `status "Action status"` | `Rejecting.` | `Rejected <release id>. Assembler notice queued.` | |
| Reopen | `status "Action status"` | `Reopening.` | `Reopened <release id>.` | |
| Share | `status "Action status"` | `Confirming derivatives.` | `Shared <release id>. Every derivative is confirmed present.` | `Not shared. Exhibit storage is unreachable, so the derivatives could not be confirmed.` |
| Revoke, regenerate link | `status "Action status"` | `Updating link.` | `Link revoked.` / `New link ready. The old link no longer works.` | |
| Withdraw | `status "Action status"` | `Withdrawing.` | `Withdrawn <release id>.` | |
| Break-glass | `status "Action status"` | `Opening break-glass.` | `Break-glass open until <time>. Owner notice queued.` | |
| Collect | `status "Collection status"` | `Preparing <label>.` | `Collected <label>. Digest matches.` | `Collection unavailable. Exhibit storage is unreachable.` |
| Sign in again | `status "Sign-in again status"` | `Signing in.` | The dialog closes | |
| Custody check | `status "Custody status"` | `Checking custody.` | `<n> entries checked. All match their digests. Run Chain Walk to prove the whole chain.` | |
| Lattice verdict | `status "Lattice verdict"` | `Verifying links.` | `All <count> links verified.` | |

**Upload announcements.** `status "Intake status"` announces the upload copy only at 0, 25, 50, 75 and 100 percent, each once and in that order, even when progress passes more than one at a time. It then announces `Confirming storage.`, then the success copy. `progressbar "Upload progress"` stays below 100 while bytes remain to be sent.

**Held notice.** When a sign-off, rejection or break-glass response has `notice` of `held`, the success copy for that action drops its final notice sentence and is followed, after one space, by `Notice held. It will send when the mail relay returns.`

**Release state words.** The whole text of `status "Release state"` is the display word for the release's state, with nothing else beside it. It updates with the release, on the delay stated under Update delays.

| API state | Text of `status "Release state"` |
|---|---|
| `assembling` | `Assembling` |
| `submitted` | `Submitted` |
| `signed off` | `Signed off` |
| `rejected` | `Rejected` |
| `shared` | `Shared` |
| `withdrawn` | `Withdrawn` |

**Field and refusal copy**

| Trigger | Where | Copy |
|---|---|---|
| Failed sign-in | `alert` "Sign-in status", `status "Sign-in again status"` | `Email or password is not right.` |
| Locked sign-in | `alert` "Sign-in status", `status "Sign-in again status"` | `Too many attempts. Try again later.` |
| Wrong step-up | `status "Step-up status"` | `Password or code is not right.` |
| Step-up locked | `status "Step-up status"` | `Too many attempts. Try again later.` |
| Declared type and bytes disagree | `errors.file`, Intake status, error summary | `The declared type does not match the file.` |
| Unaccepted type, including a `declared_type` that is present but off the accepted list | `errors.file` | `This file type is not accepted.` |
| Unsafe file name | `errors.file` | `This file name is not accepted.` |
| Submitted digest differs | `errors.file` | `The file does not match the submitted digest.` |
| File too large | Intake status, error summary | `This file is over the 20,000,000 byte limit.` |
| Connection lost before an answer | `status "Intake status"` | `Connection lost. Press Register exhibit to try again; it will not create a second exhibit.` |
| Required copy: a required field that is missing, a value empty after trimming, or a value of the wrong type or outside its list, as settled under Choosing a field's copy | `errors.<field>` | `This field is required.` |
| Over-length copy: a value over its maximum length, for every field with a maximum in Validation limits apart from `Idempotency-Key` | `errors.<field>` | `Keep this to <max> characters or fewer.` |
| Unstorable copy: characters that cannot be stored | `errors.<field>` | `This field holds characters that cannot be stored.` |
| Unreadable request body | `errors.body` | `This request could not be read.` |
| Unusable idempotency key | `errors.idempotency_key` | `This key cannot be used.` |
| Date copy | `errors.collected_on` | `Enter a date that is not in the future, as YYYY-MM-DD.` |
| Page copy | `errors.page` | `Choose a page of this exhibit.` |
| Reason copy, on every reason but break-glass | `errors.reason` | `Write a reason of at least 10 characters.` |
| Reason copy, on break-glass | `errors.reason` | `Write a reason of at least 20 characters.` |
| Regions copy | `errors.regions` | `Each region must sit inside its page.` |
| Future-time copy | `errors.expires_at` | `Choose a time in the future.` |
| 90-day copy | `errors.expires_at` | `Choose a time within 90 days.` |
| Stale grant write | `status "Action status"` | `Someone else changed this access list. Review it and try again.` |
| Last case lead | `status "Action status"` | `This compartment needs another case lead with full access first.` |
| Stale marks | `status "Redaction status"` | `Someone else changed these marks. Review them and try again.` |
| Render with unsaved marks | `status "Redaction status"` | `Save your marks before rendering.` |
| Superseded derivative | `status "Action status"` | `A newer set of marks exists for <derivative id>. Render again and replace it.` |
| Release changed under review | `status "Action status"` | `This release changed while you were reviewing it. Review it again.` |
| Items not yet opened | `status "Action status"` | `Open every item before signing off. Not opened yet: <count>.` |
| Seal check failed | `status "Action status"` | `Not cleared. The stored file no longer matches its seal.` |
| Lost a race on clear, refuse, sign-off or reject | `status "Action status"` | `Already decided by someone else.` |
| Any other illegal transition | `status "Action status"` | `This action is no longer available.` |
| Held exhibit disposal | `status "Action status"`, with hold icon and word | `Under legal hold. This exhibit cannot be disposed of.` |
| Matter already holding the exhibit | `status "Action status"` | `This matter already holds this exhibit.` |
| Separation of duties on a release | `status "Action status"` | `You worked on this release, so someone else must decide it.` |
| Separation of duties on an exhibit | `status "Action status"` | `You registered this exhibit, so another officer must decide it.` |
| Separation of duties on a disposal | `status "Action status"` | `You proposed this disposal, so another case lead must confirm it.` |
| Quarantined exhibit | `status "Action status"` | `This exhibit has not been cleared.` |
| Throttled collection | `status "Collection status"` | `Collection paused. Try again in <seconds> seconds.` |
| Collected file failed its digest check | `status "Collection status"` | `This file failed its digest check. Nothing was saved.` |
| Collected with no Web Crypto in the browser | `status "Collection status"` | `Collected <label>. Digest not checked in this browser.` |
| Custody entry fails its check | `status "Custody status"` | `Entry <seq> does not match its digest.` |
| Custody lookup answers not found | `status "Custody status"` | `No exhibit with this id.` |

**Choosing a field's copy.** A refused field gets exactly one copy, and each 422 names every refused field. These fields answer as this table says, and every other field answers missing, null, empty and wrong-type values with the required copy.

| Field | Missing, null, or empty after trimming | Wrong type | Present but not acceptable |
|---|---|---|---|
| `reason` | Reason copy | Required copy | Shorter than its minimum: reason copy |
| `collected_on` | Required copy | Required copy | A string that is not a real `YYYY-MM-DD` date, or a future date: date copy |
| `capture_notes` | Accepted and never refused, so the registration answers 201 if nothing else is refused. `provenance.capture_notes` then reads null | Does not arise, as a multipart value is always text | Unstorable characters: unstorable copy. Otherwise, over its maximum length: over-length copy |
| `submitted_sha256` | Accepted and never refused, so the registration answers 201 if nothing else is refused, with no digest comparison | Does not arise, as a multipart value is always text | Any value that differs from the computed digest, compared exactly after trimming, however malformed: `errors.file` with the submitted-digest copy, under Upload checks |
| `page` | Required copy | Required copy, for anything other than a whole number, including a fraction, a boolean and a numeric string | A whole number outside 1 to the exhibit's `page_count`: page copy |
| `regions` | Required copy; an empty list is valid and is not empty in this sense | Required copy, for anything other than a list | A list with any entry that is not an object, lacks a key, holds a non-integer, or breaks the Saved marks limits: regions copy |
| Grant `expires_at` | Required copy, for missing or an empty string; null is valid | Required copy, for anything other than a string or null | A string that is not a time, or a time not later than now: future-time copy |
| Link `expires_at` | Required copy | Required copy, for anything other than a string | A string that is not a time, or a time not later than now: future-time copy. A later time beyond 90 days: 90-day copy |
| `marks_version`, `access_version` | Required copy | Required copy, for anything other than a whole number, including a fraction, a boolean and a numeric string | A whole number other than the current one, negative numbers included: `stale_marks` or `stale_access_list`, never a field copy |
| `manifest_digest` | Required copy | Required copy, for anything other than a string | Any other string that is not the current digest, however malformed, unstorable characters included: `release_changed`, never a field copy |

A missing, null, empty or wrong-type `marks_version`, `access_version` or `manifest_digest` has nothing to compare, so it never answers `stale_marks`, `stale_access_list` or `release_changed`. The request's other state conflicts are still checked in their row's order, and if none holds, it answers validation with the required copy on that field, alongside any other refused field. For example, a `PUT` with no `marks_version` and bad regions answers 422 with both `errors.marks_version` and `errors.regions`. A value in the last column is a state conflict and so outranks validation: a `PUT` with an old whole-number `marks_version` and bad regions answers only `stale_marks`.

A `collected_on` or `expires_at` string holding unstorable characters is simply not a date or time, and takes the last column. For a required free text field (`name`, `source`, `collected_by`, `matter_ref`, `label`, `reason`, `text`), the first of these that holds is the answer: missing, null, empty or wrong type; unstorable characters; over its maximum length; for `reason`, under its minimum. A body id (`user_id`, `derivative_id`, `hold_id`) that is missing, null, empty after trimming or not a string answers the required copy, and any other string is an id that follows Denials and Malformed input. `declared_type` is settled under Upload checks.

**Where field errors render.** Each `errors.<field>` copy appears as text directly below the control that carries that field, and that control is marked invalid and described by the text:

- `errors.reason` appears below `textbox "Reason"` in the step-up dialog. For break-glass it appears below `textbox "Break-glass reason"`, because break-glass takes its reason from that field and its dialog shows no `textbox "Reason"`.
- `errors.expires_at` appears below `textbox "Lapses at"` or `textbox "Link lapses at"`.
- `errors.regions` and `errors.marks_version` have no control of their own and appear in `status "Redaction status"`.
- `errors.access_version` and `errors.manifest_digest` have no control of their own and appear in `status "Action status"`.
- `errors.matter_ref` appears below `textbox "Hold matter"` on the exhibit page, and below `textbox "Matter reference"` in the new release dialog.
- `errors.text` appears below `textbox "Find text"`.
- Every other field's copy appears below the textbox, combobox or file input carrying that field.

A refusal of a field outside the step-up dialog closes that dialog, leaves the form behind it open with its typed values, and moves focus to that field. The copy is also announced in the action's region from the first table in this section, or in `status "Step-up status"` while the dialog stays open. On the intake form, each field error also appears as a link in `alert "There is a problem"`, and `status "Intake status"` reads each copy in form order, separated by one space.

**Fixed copy**

| Trigger | Where | Copy |
|---|---|---|
| Storage down | `alert "Service notice"` | `Exhibit storage is unreachable. Registration and downloads are paused; nothing has been lost.` |
| Mail down | `alert "Service notice"` | `The mail relay is unreachable. Notices are held and will send when it returns.` |
| No record chosen | `region "Inspector"` | `Choose a row to inspect it.` |
| Grant ended on an open page | `alert "Access ended"` | `Your access to this compartment has ended.` |
| Grant narrowed on an open exhibit page | `alert "Access changed"` | `Your access to this compartment has changed to derivatives only.` |
| Holding break-glass | `status "Break-glass time"` | `Break-glass ends at <time>.` |
| Session ended | `/sign-in`, `alert` "Sign-in status" | `Your session has ended.` |
| Session ended with unsaved work | `status "Sign-in again status"` | `Your session has ended. Sign in to finish what you were doing.` |
| Grant with a lapse time | Access list row | `Lapses <lapse> UTC` |
| Grant with no lapse time | Access list row | `Does not lapse` |
| Review queue count | `status "Review queue count"` | `<n> waiting for a decision.` |
| Not found page, and dead link page | Heading | `Nothing to show at this address.` |
| Counsel link heading | Heading | `Disclosure for matter <matter>` |
| Requester link heading | Heading | `Your disclosure` |
| Compartment totals | `status "Compartment totals"` | `<quarantined> in quarantine. <bytes> bytes in releases.` |
| Walk, head at link 0 | `status "Walk result"` | `Start of the chain.` |
| Walk, link verified | `status "Walk result"` | `Link <n> verified.` |
| Walk, break | `status "Walk result"` | `Break at link <n>.` |
| Walk or lattice, no Web Crypto | `status "Walk result"`, `status "Lattice verdict"` | `Cannot verify in this browser. Open Wardline over HTTPS or on this machine.` |
| Anchor copied | `status "Anchor status"` | `Anchor copied.` |
| Anchor selected because the clipboard refused | `status "Anchor status"` | `Anchor selected. Copy it now.` |
| Anchor accepted for later | `status "Anchor status"` | `Anchor for link <n> added. It will be tested when the walk reaches it.` |
| Anchor matches at once | `status "Anchor status"` | `Anchor for link <n> matches.` |
| Anchor fails at once | `status "Anchor status"` | `Anchor for link <n> does not match.` |
| Anchor malformed | `status "Anchor status"` | `This is not a Wardline anchor.` |
| Region changed | `status "Redaction status"` | `Region <n> at <x>, <y>, size <w> by <h>.` |
| Lattice, break | `status "Lattice verdict"` | `Break at link <n>. <faulted> links drawn in fault.` |
| Lattice, still frame in use | `status "Lattice path notice"` | `3D view unavailable in this browser. This still frame shows the same verdict and link count.` |
| Lattice, camera came to rest after key, drag or reset | `status "Lattice camera"` | `Yaw <yaw> degrees, pitch <pitch> degrees.` |
| Link details, verified | `status "Link details status"` | `Link <n>: verified.` |
| Link details, the broken link | `status "Link details status"` | `Link <n>: break.` |
| Link details, after the break | `status "Link details status"` | `Link <n>: in fault.` |
| Link details, no such link | `status "Link details status"` | `There is no link <n> in this chain.` |
| Link details, not a whole number | `status "Link details status"` | `Enter a link number.` |
| Timeline at the first stop | `status "Custody timeline status"` | `Start of custody. Entry 1 of <total>.` |
| Timeline between | `status "Custody timeline status"` | `Entry <position> of <total>.` |
| Timeline at the last stop | `status "Custody timeline status"` | `Latest custody entry. Entry <total> of <total>.` |

With one entry, the timeline uses the last-stop copy.

**Update delays.**
- The compartment docket's access list, quarantine count, release byte total and tables refresh in place within 5 seconds of another person's action, without a page load.
- `table "Quarantine"` on the intake route, `table "Review queue"` and `status "Review queue count"` on the queue route, and the release's state, items and `data-manifest-digest` on the release route, refresh in place within 5 seconds of another person's action.
- `/compartments/<id>`, `/exhibits/<id>` and `/releases/<id>` check the server at least every 5 seconds. Within 5 seconds of the grant ending, by revocation, lapse or a break-glass end, the page removes every digest, provenance value, preview, table and control of that compartment from both panes, drops that compartment's link from `navigation "Compartments"`, and shows the access-ended notice. Within 5 seconds of a full grant narrowing to derivatives, the exhibit page changes as stated under Grant changes in Interactions.
- `status "Break-glass time"`, access list lapse text and the access-ended notice follow the server's published status. The browser's clock and time zone never decide or format anything about them, and the time is always shown in UTC.
- Every signed-in page checks `GET /api/session` at least every 10 seconds.
- Every automatic check a page makes, whichever kind, sends the background header from the Sessions rule.
- Outage banners appear or clear within 10 seconds of the server's status changing, with no reload. A banner appearing or clearing never moves focus, closes a dialog, or changes or hides an action's own message, typed values or a chosen file.

## Backend

### API (DP-01, DP-03, DP-07, DP-08, DP-09, DP-12, DP-18, DP-19, DP-20, DP-23, DP-25, DP-32, DP-33, DP-37, DP-39, DP-41, DP-46, DP-49, DP-50, DP-51, DP-55, DP-56, DP-59, DP-60, DP-61, DP-62, DP-67, DP-70, DP-72, DP-73, DP-80, DP-82, DP-93, DP-98)

All bodies are `application/json` except registration, which is `multipart/form-data`. Sessions use an `HttpOnly`, `SameSite=Strict` cookie. Times are UTC in the form `2026-10-30T12:00:00Z` on requests and in responses, except the ledger's `at`, defined in the Single ledger chain rule. Privileged endpoints, marked **P**, need the header `X-Step-Up-Proof`.

**Error precedence, for the whole API:** request-shape refusals (`forbidden_origin`, `body_too_large`, `file_too_large`, `unsupported_media_type`, `method_not_allowed`), then unauthenticated, then unknown or out-of-grant resource, then role and separation refusals, then missing step-up proof, then state conflicts, then validation. An idempotent replay returns its stored response right after authentication, before any other check. Where one action can meet more than one state conflict, the row's order applies: the first error listed that holds is the answer. A `marks_version`, `access_version` or `manifest_digest` with no usable value cannot meet its stale or changed conflict, as settled under Choosing a field's copy in Feedback states.

**Error catalogue.** Each row is the one definition of that error.

| Code | Status | Body |
|---|---|---|
| `unauthenticated` | 401 | `{"error":"unauthenticated"}` |
| `sign_in_failed` | 401 | `{"error":"sign_in_failed"}` |
| `sign_in_locked` | 429 with `Retry-After` in seconds | `{"error":"sign_in_locked"}` |
| `not_found` | 404 | `{"error":"not_found"}` |
| `forbidden` | 403 | `{"error":"forbidden"}` |
| `forbidden_origin` | 403 | `{"error":"forbidden_origin"}` |
| `separation_of_duties` | 403 | `{"error":"separation_of_duties"}` |
| `step_up_required` | 403 | `{"error":"step_up_required"}` |
| `step_up_failed` | 403 | `{"error":"step_up_failed"}` |
| `illegal_transition` | 409 | `{"error":"illegal_transition","from":"<state>","to":"<state>"}` |
| `stale_access_list` | 409 | `{"error":"stale_access_list","access_version":<current integer>}` |
| `last_case_lead` | 409 | `{"error":"last_case_lead"}` |
| `stale_marks` | 409 | `{"error":"stale_marks","marks_version":<current integer>}` |
| `grant_exists` | 409 | `{"error":"grant_exists"}` |
| `grant_not_active` | 409 | `{"error":"grant_not_active"}` |
| `exhibit_not_cleared` | 409 | `{"error":"exhibit_not_cleared","state":"<state>"}` |
| `seal_mismatch` | 409 | `{"error":"seal_mismatch","sha256":"<sealed digest>"}` |
| `release_empty` | 409 | `{"error":"release_empty"}` |
| `release_locked` | 409 | `{"error":"release_locked","state":"<state>"}` |
| `release_changed` | 409 | `{"error":"release_changed","manifest_digest":"<current digest>"}` |
| `derivative_superseded` | 409 | `{"error":"derivative_superseded","derivative_id":"<id>"}` |
| `items_unopened` | 409 | `{"error":"items_unopened","item_ids":["<item id>"]}`, in item id order |
| `not_previewable` | 409 | `{"error":"not_previewable"}` |
| `not_redactable` | 409 | `{"error":"not_redactable"}` |
| `legal_hold` | 409 | `{"error":"legal_hold"}` |
| `hold_exists` | 409 | `{"error":"hold_exists"}` |
| `exhibit_in_release` | 409 | `{"error":"exhibit_in_release"}` |
| `already_granted` | 409 | `{"error":"already_granted"}` |
| `break_glass_active` | 409 | `{"error":"break_glass_active"}` |
| `derivative_missing` | 409 | `{"error":"derivative_missing"}` |
| `idempotency_conflict` | 409 | `{"error":"idempotency_conflict"}` |
| `method_not_allowed` | 405 | `{"error":"method_not_allowed"}` |
| `body_too_large` | 413 | `{"error":"body_too_large"}` |
| `file_too_large` | 413 | `{"error":"file_too_large","max_bytes":20000000}` |
| `unsupported_media_type` | 415 | `{"error":"unsupported_media_type"}` |
| validation | 422 | `{"errors":{"<field>":"<copy from Feedback states>"}}` |
| `throttled` | 429 with `Retry-After` in seconds | `{"error":"throttled"}` |
| `storage_unavailable` | 503 | `{"error":"storage_unavailable"}` |
| `service_unavailable` | 503 | `{"error":"service_unavailable"}`; only while the database cannot be reached |

Every authenticated endpoint can answer `unauthenticated`, and every endpoint with an id can answer `not_found`. Every endpoint with a body can answer validation for `errors.body`. Rows below name only their other errors.

**Platform and session**

| Method and path | Request | Success | Other errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` | |
| `GET /api/status` (no session needed) | | 200 `{"storage":"up"\|"down","mail":"up"\|"down"}` | |
| `POST /api/sign-in` | `{"email","password"}`, optional `"next"` | 200 `{"user":{"id","name","role"},"session_id","landing":"<route>"}` | `sign_in_failed`, `sign_in_locked`, validation |
| `POST /api/sign-out` | `{}` | 204 | |
| `GET /api/session` | | 200 `{"user":{...},"session_id","server_time","break_glass":[{"compartment_id","ends_at"}]}` | |
| `POST /api/step-up` | `{"password","code"}` | 201 `{"proof":"<token>","expires_in_seconds":<integer>}` | `step_up_failed`, `sign_in_locked`, validation |
| `POST /api/users/{id}/sessions/revoke` **P** | `{}` | 200 `{"revoked":<integer>}` | `forbidden` |
| `GET /api/directory` | | 200 `{"people":[{"id","name","role"}]}` | `forbidden` |

`role` is one of `intake_officer`, `case_lead`, `investigator` or `auditor`. Without a `next` that is honoured, `landing` is `/intake`, `/compartments` for a case lead or investigator, and `/ledger` for an auditor. `session_id` is a public record id, distinct from the session cookie's value. `break_glass` lists the caller's active break-glass grants, and `server_time` is the server's current time.

**Compartments and access**

| Method and path | Request | Success | Other errors |
|---|---|---|---|
| `GET /api/dashboard` | | 200 `{"compartments","exhibits","quarantined","held","releases_in_review","release_bytes"}` (integers) | |
| `GET /api/search?q=` | | 200 `{"results":[{"exhibit_id","compartment_id","name","state"}]}` | |
| `GET /api/compartments` | | 200 `{"compartments":[{"id","name","exhibit_count","quarantine_count","release_bytes"}]}` | |
| `POST /api/compartments` | `{"name"}` | 201 compartment | `forbidden`, validation |
| `GET /api/compartments/{id}` | | 200 `{"id","name","owner_id","access_version","caller_scope","exhibit_count","quarantine_count","release_bytes","access":[grant]\|null}` | |
| `POST /api/compartments/{id}/grants` **P** | `{"user_id","scope","expires_at","access_version"}` | 201 grant | `forbidden`, `stale_access_list`, `grant_exists`, validation |
| `PATCH /api/grants/{id}` **P** | `{"scope","expires_at","access_version"}` | 200 grant | `forbidden`, `stale_access_list`, `grant_not_active`, `last_case_lead`, validation |
| `POST /api/grants/{id}/revoke` **P** | `{}` | 200 grant | `forbidden`, `grant_not_active`, `last_case_lead` |
| `POST /api/compartments/{id}/break-glass` **P** | `{"reason"}`, optional `Idempotency-Key` | 201 `{"id","compartment_id","ends_at","state":"active","notice":"queued"\|"held"}` | `forbidden`, `already_granted`, `break_glass_active`, `idempotency_conflict`, validation |

A grant is `{"id","compartment_id","user_id","scope","state","expires_at","kind"}`. `scope` is `full` or `derivatives`, `state` is `active`, `revoked` or `lapsed` for a `grant` and `active` or `ended` for a `break_glass`, `kind` is `grant` or `break_glass`, and `expires_at` may be null. `caller_scope` is the scope of the caller's active grant on this compartment. `access` is non-null only for a case lead with a full grant, and lists every grant on the compartment in any state.

**Exhibits and files**

| Method and path | Request | Success | Other errors |
|---|---|---|---|
| `POST /api/compartments/{id}/exhibits` | Multipart fields `file`, `name`, `declared_type`, `source`, `collected_by`, `collected_on`, optional `capture_notes`, optional `submitted_sha256`; optional header `Idempotency-Key` | 201 `{"id","compartment_id","state":"quarantined","sealed":true,"sha256","size","sniffed_type"}` | `forbidden`, `idempotency_conflict`, `storage_unavailable`, validation |
| `GET /api/compartments/{id}/exhibits?state=` | | 200 `{"exhibits":[exhibit]}` | |
| `GET /api/exhibits/{id}` | | 200 exhibit | |
| `POST /api/exhibits/{id}/clear` **P** | `{}` | 200 exhibit | `forbidden`, `separation_of_duties`, `illegal_transition`, `storage_unavailable`, `seal_mismatch` |
| `POST /api/exhibits/{id}/refuse` **P** | `{"reason"}` | 200 exhibit | `forbidden`, `separation_of_duties`, `illegal_transition`, validation |
| `POST /api/exhibits/{id}/hold` **P** | `{"reason","matter_ref"}` | 200 exhibit | `forbidden`, `illegal_transition`, `hold_exists`, validation |
| `POST /api/exhibits/{id}/lift-hold` **P** | `{"hold_id","reason"}` | 200 exhibit | `forbidden`, validation |
| `POST /api/exhibits/{id}/dispose` **P** | `{"reason"}` | 200 exhibit | `forbidden`, `legal_hold`, `exhibit_in_release`, `illegal_transition`, validation |
| `POST /api/exhibits/{id}/dispose/confirm` **P** | `{}` | 200 exhibit | `forbidden`, `separation_of_duties`, `legal_hold`, `illegal_transition`, `storage_unavailable` |
| `POST /api/exhibits/{id}/dispose/cancel` **P** | `{"reason"}` | 200 exhibit | `forbidden`, `illegal_transition`, validation |
| `POST /api/exhibits/{id}/preview-grants` | `{"page"}` | 201 `{"token","expires_in_seconds":60}` | `forbidden`, `exhibit_not_cleared`, `not_previewable`, `storage_unavailable`, validation |
| `POST /api/exhibits/{id}/download-grants` | `{}` | 201 `{"token","expires_in_seconds":60}` | `forbidden`, `exhibit_not_cleared` |
| `GET /api/exhibits/{id}/redactions` | | 200 `{"regions":[{"page","x","y","w","h"}],"marks_version":<integer>}` | `forbidden` |
| `PUT /api/exhibits/{id}/redactions` | `{"regions":[...],"marks_version":<integer>}` | 200 same shape as `GET` | `forbidden`, `exhibit_not_cleared`, `not_redactable`, `stale_marks`, validation |
| `POST /api/exhibits/{id}/redactions/find` | `{"text"}` | 200 `{"matches":[{"page","x","y","w","h"}]}` | `forbidden`, `exhibit_not_cleared`, `not_redactable`, `storage_unavailable`, validation |
| `POST /api/exhibits/{id}/derivatives` | `{}` | 201 derivative | `forbidden`, `exhibit_not_cleared`, `not_redactable`, `storage_unavailable` |
| `GET /api/exhibits/{id}/derivatives` | | 200 `{"derivatives":[derivative]}` | |
| `GET /api/exhibits/{id}/custody?after=&limit=` | | 200 `{"entries":[entry],"next_after":<integer or null>}` | `forbidden` |
| `GET /api/derivatives/{id}` | | 200 derivative | |
| `POST /api/derivatives/{id}/download-grants` | `{}` | 201 `{"token","expires_in_seconds":60}` | `exhibit_not_cleared` |
| `GET /api/download/{token}` (no session needed) | | 200 file bytes | `storage_unavailable` |

An exhibit is `{"id","compartment_id","name","state","sealed":true,"sha256","size","sniffed_type","page_count","registered_by","marks_version","seal_check","disposal_proposed_by","holds":[{"id","matter_ref","placed_by"}],"provenance":{"source","collected_by","collected_on","capture_notes"}}`. `page_count` is null for audio and unreadable files. `provenance` is null for a caller with a derivatives-scoped grant. `holds` lists active holds only. `seal_check` is null or `failed`. `disposal_proposed_by` is a person id while the state is `disposal proposed`, otherwise null.

A derivative is `{"id","exhibit_id","compartment_id","sha256","size","content_type","page_count","created_by","marks_version","marks_saved_by","superseded","disposed"}`. `marks_saved_by` is the person who saved the marks it was rendered from, or null if none were ever saved.

**Releases and links**

| Method and path | Request | Success | Other errors |
|---|---|---|---|
| `GET /api/reviews` | | 200 `{"releases":[release]}` | `forbidden` |
| `POST /api/compartments/{id}/releases` | `{"name","matter_ref","recipient_kind"}` | 201 release | `forbidden`, validation |
| `GET /api/compartments/{id}/releases` | | 200 `{"releases":[release]}` | |
| `GET /api/releases/{id}` | | 200 release | |
| `POST /api/releases/{id}/items` | `{"derivative_id","label"}` | 201 release | `forbidden`, `release_locked`, `exhibit_not_cleared`, `derivative_superseded`, validation |
| `DELETE /api/releases/{id}/items/{item_id}` | | 200 release | `forbidden`, `release_locked` |
| `POST /api/releases/{id}/submit` **P** | `{}` | 200 release | `forbidden`, `illegal_transition`, `release_empty`, `derivative_superseded` |
| `POST /api/releases/{id}/sign-off` **P** | `{"manifest_digest"}` | 200 release with `notice` | `forbidden`, `separation_of_duties`, `illegal_transition`, `release_changed`, `derivative_superseded`, `items_unopened`, validation |
| `POST /api/releases/{id}/reject` **P** | `{"reason"}` | 200 release with `notice` | `forbidden`, `separation_of_duties`, `illegal_transition`, validation |
| `POST /api/releases/{id}/reopen` | `{}` | 200 release | `forbidden`, `illegal_transition` |
| `POST /api/releases/{id}/share` **P** | `{"expires_at"}` | 201 `{"release_id","state":"shared","link_id","token","url":"/l/<token>","expires_at"}` | `forbidden`, `illegal_transition`, `derivative_superseded`, `derivative_missing`, `storage_unavailable`, validation |
| `POST /api/releases/{id}/link/revoke` **P** | `{}` | 200 `{"link_id","state":"revoked"}` | `forbidden`, `illegal_transition` |
| `POST /api/releases/{id}/link/regenerate` **P** | `{"expires_at"}` | 201 same body as share | `forbidden`, `illegal_transition`, `derivative_superseded`, `derivative_missing`, `storage_unavailable`, validation |
| `POST /api/releases/{id}/withdraw` **P** | `{}` | 200 release | `forbidden`, `illegal_transition` |
| `GET /api/links/{token}` (no session) | | 200 `{"reference","name","matter_ref","recipient_kind","manifest_digest","items":[{"id","label","sha256","size"}]}` | |
| `POST /api/links/{token}/items/{item_id}/grant` (no session) | `{}` | 201 `{"token","expires_in_seconds":60}` | `throttled`, `storage_unavailable` |

A release is `{"id","compartment_id","name","matter_ref","recipient_kind","state","assembler_id","contributor_ids","manifest_digest","items":[{"id","derivative_id","label","size","superseded","opened_by_caller"}],"total_bytes","rejection_reason","notice"}`. `notice` is present only on decision responses. `opened_by_caller` says whether the caller has a committed download claim for that item's derivative.

`recipient_kind` is `counsel` or `requester`. `reference` on the link-holder response is the release's id, for example `REL-0001` with the seed data at start. Link-holder routes never include `assembler_id`, exhibit ids or exhibit names. Any other method on `/api/links/{token}` or below it answers `method_not_allowed`.

**Ledger and signals**

| Method and path | Request | Success | Other errors |
|---|---|---|---|
| `GET /api/ledger?after=&limit=&action=` | | 200 `{"entries":[entry],"count":<number of rows>}` | `forbidden` |
| `GET /api/signals` | | 200 `{"signals":[{"id","kind","at","target"}]}` | `forbidden` |

`after` defaults to 0. `limit` defaults to 200, the most it accepts is 1,000, and anything above that is treated as 1,000. An `after` or `limit` that is not a whole number within a 64-bit range, a negative `after`, or a `limit` below 1 takes its default. Entries are in ascending `seq` order, and `after` returns rows whose `seq` is greater than its value. `kind` is `bulk_collection`, `sign_in_lockout` or `seal_mismatch`. An entry is `{"seq","at","actor_id","session_id","action","target","detail","prev_digest","digest"}`.

`count` is the number of rows in the whole ledger at the moment of the request, whatever `after`, `limit` and `action` say. It is the ledger's link count: the slider's maximum, the rail's scroll range, the lattice's node count and `<count>` all use it, so a row deleted below the application lowers it by one. A gap in `seq` always has a row after it, so the link a gap names is never above `count`. The slider's maximum goes above `count` only under the Breaks rule for a remembered link beyond the chain's end.

`GET /api/exhibits/{id}/custody` takes `after` and `limit` by the same rules, and `after` works on `seq`. `next_after` is the `seq` of the last entry returned when further entries belonging to this exhibit exist at the moment of the request, otherwise null.

**Size limits.**
- A JSON body may be up to and including 1,000,000 bytes.
- An uploaded file may be up to and including 20,000,000 bytes, and one byte more answers `file_too_large`.
- A multipart body over 20,500,000 bytes also answers `file_too_large`.
- A JSON endpoint given another content type answers `unsupported_media_type`.

**Validation limits.**
- Lengths are in characters after trimming. Trimming removes leading and trailing spaces, tabs, carriage returns and line feeds, and nothing else.
- `name`, `collected_by`, `matter_ref`: 1 to 200.
- `source`: 1 to 500.
- `capture_notes`: at most 2,000.
- `label`: 1 to 120.
- `text` on find: 1 to 200.
- `reason`: 10 to 2,000, except break-glass, which is 20 to 2,000.
- `collected_on`: `YYYY-MM-DD`, today or earlier.
- Grant `expires_at`: null or later than now.
- Link `expires_at`: later than now and at most 90 days from now.
- `Idempotency-Key`: 1 to 128 characters.
- `marks_version`, `access_version`: whole numbers.

Each maximum is itself allowed. One character more answers validation on that field with the over-length copy from Feedback states, and an `Idempotency-Key` outside its range answers the unusable-key copy.

### Business rules (DP-01, DP-03, DP-04, DP-05, DP-07, DP-10, DP-11, DP-12, DP-16, DP-17, DP-19, DP-20, DP-23, DP-24, DP-25, DP-26, DP-30, DP-32, DP-33, DP-34, DP-35, DP-36, DP-37, DP-39, DP-40, DP-44, DP-45, DP-46, DP-49, DP-50, DP-51, DP-52, DP-55, DP-56, DP-59, DP-60, DP-62, DP-63, DP-65, DP-67, DP-69, DP-72, DP-73, DP-74, DP-82, DP-85, DP-89, DP-93, DP-94)

**Who can do what.** Each person has one role. Apart from the auditor's ledger, signals and custody, and a case lead's break-glass, every compartment action also needs an active grant on that compartment. No grant gives `not_found`; a grant with the wrong role gives `forbidden`. A compartment's creator becomes its owner and receives a full grant.

| Action | Roles | Grant scope |
|---|---|---|
| Register, clear, refuse | Intake officer | Full |
| Issue, edit, revoke grants; end sessions; hold, lift, propose, confirm and cancel disposal; sign off, reject; share, link actions, withdraw | Case lead | Full |
| Create compartment, read directory and review queue | Case lead | No grant needed |
| Preview, find text, redact, render, download original | Investigator, case lead | Full |
| Download original | Intake officer | Full |
| Create release, add and remove items, submit, reopen | Investigator, case lead | Full or derivatives |
| List exhibits, read exhibit without provenance, download a derivative | Any role with a grant | Full or derivatives |
| Read custody history | Case lead, including through break-glass | Full |
| Read custody history | Auditor | None |
| Read ledger and signals | Auditor | None |

The endpoints for ending sessions, the directory and the review queue have no compartment id, so a lower role gets `forbidden`. The review queue answers any case lead with 200 and lists only submitted releases in compartments where that lead holds an active full grant of kind `grant`.

**Derivatives-scoped callers.**
- A derivatives-scoped member asking for an original, preview, find, redaction or render gets `not_found`, and that denial is written like any other. Asking for custody history gets the same answer, unless the caller is an auditor, whom the table admits with no grant.
- The right role holding only a derivatives-scoped grant on the compartment gets `forbidden` for every other action the table limits to full scope, with one `access.denied` entry and any proof left unused. These actions are register, clear and refuse for an intake officer, and for a case lead: issue, edit and revoke grants; hold, lift, and propose, confirm and cancel disposal; sign off and reject; and share, link actions and withdraw.
- Ending sessions follows its own rule under Sessions.

A person with a full grant and any other role asking for custody history gets `forbidden`. An auditor holds no grants unless a case lead issues one, and a grant gives them only the any-role row.

**Denials.** For a signed-in person, each of these refusals writes one `access.denied` ledger entry in the same transaction as the refusal: `not_found` on a compartment, exhibit, derivative, release, grant, release item, hold or person; `forbidden`; `separation_of_duties`; and `step_up_required`. The entry's `detail` holds `method`, `path` and `code`, where `code` is the error code. Its `target` is the id that caused the refusal. For `not_found`, that is the first unknown or out-of-grant id, taking path ids from left to right and then body ids, so a release in the path with a foreign derivative in the body has the derivative's id as its target, and a compartment in the path with an unknown `user_id` has that `user_id`. For `forbidden`, `separation_of_duties` and `step_up_required`, it is the last id in the path. A request that names no id has its path, without the query string, as its target. No other refusal writes `access.denied`, including `step_up_failed`, state conflicts, validation, a path that matches no published route, and any `not_found` from `GET /api/download/{token}` or the link routes. An unknown id and an id outside the caller's grants look the same to the caller. An id inside a request body gets the same treatment, so a derivative or person from another compartment in a body answers `not_found`, never validation. `user_id` in a grant request is checked against the directory, and an unknown one answers `not_found`.

**Malformed input.** No request answers a 500 or carries a stack trace, SQL, a file path or a library name.
- A path or body id that is a string but holds NUL, an invalid byte sequence, an encoded path separator, or any great length is simply an unknown id. It answers `not_found` and writes one `access.denied`, except on the routes excluded under Denials.
- `detail.path` is the raw percent-encoded path as sent, without the query string, cut to its first 1,000 characters.
- `target` for such an id, and for every other id, is the id's bytes as decoded once from the path or as UTF-8 from the body, with every byte other than ASCII letters, digits, `-`, `_`, `.` and `~` written as upper-case `%XX`, cut to its first 200 characters. A lone surrogate in a JSON string is written `%EF%BF%BD`. An ordinary id such as `EX-9999` is therefore unchanged.
- A body id that is not a string answers validation with the required copy on that field.
- A body that cannot be parsed, is not valid UTF-8, is not a JSON object, is nested too deeply to read, or a multipart body that cannot be parsed answers validation on `errors.body`.
- Stored text holding NUL, any other character below U+0020 except tab and line feed, U+007F or a lone surrogate answers validation on that field with the cannot-be-stored copy. A `POST /api/sign-in` whose email or password holds such characters answers `sign_in_failed` and counts towards nothing.
- A search `q` or a `state` filter holding such characters matches nothing and answers 200. Search treats `q` literally, so wildcard characters have no special meaning.
- `/l/%FF` and `/api/download/%00`, and any other unusable token, answer the dead-address responses under Sharing and Download grants, with no entry.
- A malformed `X-Step-Up-Proof` is a missing proof, and a malformed session cookie is no session.

**Derived surfaces.** Search, compartment lists and counts, and dashboard totals are computed only from compartments where the caller has an active grant at the moment of the request, including an active break-glass grant. Search matches exhibit names, ignoring case. Disposed exhibits are left out of search, `exhibit_count` and dashboard `exhibits`.

**Sign-in limits.**
- Five consecutive failed sign-ins for one email lock that email for `LOCKOUT_SECONDS`, whether or not an account exists. A success resets the count.
- During lockout, every attempt answers `sign_in_locked`, even with the right password, and `Retry-After` gives the remaining seconds.
- Failed step-ups count towards the same limit for the signed-in identity, and a locked step-up answers `sign_in_locked`.
- The server does the same password work for unknown and known accounts, so the median response time differs by less than 150 milliseconds. Status, headers other than `Retry-After`, and body are the same.
- The failure that starts a lockout writes one `signin.locked` ledger entry and raises one `sign_in_lockout` signal. Attempts during the lockout add neither.
- After a failed sign-in, that entry's actor is `system` with a null session. After a failed step-up, it is the signed-in person and their session.
- The entry's `target` and the signal's `target` are the account's person id. For an email with no account, they are `email:` followed by the lower-case hex SHA-256 of the trimmed, lower-cased email.

**Return after sign-in.** `next` on `POST /api/sign-in` becomes `landing` only if all of these hold after percent-decoding it once; otherwise `landing` silently falls back to the role's route, with no error.
- It starts with exactly one `/`, and holds no backslash, control character, `%`, query string, fragment or `..` segment.
- It has one of these exact shapes, with an id of the seed data's format: `/compartments`, `/compartments/<id>`, `/exhibits/<id>`, `/releases/<id>`, `/intake`, `/reviews`, `/ledger`, `/ledger/review`, `/audit/chain`.
- It is open to the role: `/intake` to intake officers, `/reviews` to case leads, and `/ledger`, `/ledger/review` and `/audit/chain` to auditors. Every other shape is open to any role.

`/sign-in` and `/l/<token>` are never honoured.

**Sessions.**
- A session lasts at most `SESSION_TTL_SECONDS`, and also ends after `SESSION_IDLE_SECONDS` with no activity.
- Activity is any authenticated request without the header `X-Wardline-Background: 1`. A request carrying that header never counts, on any endpoint. Every automatic check a page makes sends it. Typing sends no request and so does not count.
- The session is alive until exactly `SESSION_IDLE_SECONDS` after its last activity. From that moment on, the very next request answers `unauthenticated`, whether or not it carries the header.
- A registration that started while the session was active finishes even if the idle moment passes during the transfer, and its completion counts as activity.
- Sign-out, ending sessions and expiry all fail that session on its very next request with `unauthenticated`.
- Sign-in writes `session.opened`. Ending sessions writes `session.revoked`. Sign-out, idle expiry and the end of session life each write `session.closed`, with `detail.reason` of `signed_out`, `idle` or `expired`. An idle or life-end entry is written within 10 seconds of the end, even if no further request arrives. A failed sign-in writes no ledger entry unless it starts a lockout.

A case lead may end a person's sessions only while the lead holds an active full grant, not break-glass, on a compartment where that person holds an active grant of either kind. Any other case lead gets `forbidden`, including one whose only shared compartment is held through break-glass. An unknown person id answers `not_found`.

**Step-up.**
- A proof needs the account password and a current authenticator code. Codes follow the standard time-based scheme: SHA-1, 6 digits, 30-second steps, one step of tolerance each way. A code may be used more than once within its window, but a proof may not.
- A proof lasts `STEP_UP_TTL_SECONDS` and works only in the session that made it. From another session it answers `step_up_required`, as does a missing, expired or spent proof.
- A proof is consumed in the same transaction as the action it authorises. A request refused with `not_found`, `forbidden`, a state conflict or validation leaves it unused. Of any number of concurrent requests carrying one proof, exactly one consumes it.
- Privileged actions are the endpoints marked **P**.

**Secrets at rest.** Link tokens, download tokens, session values and step-up proofs are stored only as their SHA-256 digests. A raw token never reaches the ledger, the outbox, a stored idempotent response or any other table.

**Exhibit states.**

| From | To | Action | Who |
|---|---|---|---|
| `quarantined` | `cleared` | Clear | Intake officer who did not register it |
| `quarantined` | `refused` | Refuse | Intake officer who did not register it |
| `cleared` | `held` | Hold, adding the first hold | Case lead |
| `held` | `held` | Hold under another matter, or lift a hold that is not the last | Case lead |
| `held` | `cleared` | Lift the last hold | Case lead |
| `cleared` | `disposal proposed` | Dispose | Case lead |
| `disposal proposed` | `disposed` | Confirm | A case lead who did not propose it |
| `disposal proposed` | `cleared` | Cancel | Case lead |
| `disposal proposed` | `held` | Hold, adding the first hold and cancelling the proposal | Case lead |

Every other change answers `illegal_transition`, except proposing or confirming disposal of a held exhibit, which answers `legal_hold`. The registering officer clearing or refusing their own exhibit gets `separation_of_duties`.

While an exhibit is not `cleared`, `held` or `disposal proposed`, preview, download, redaction, find and rendering answer `exhibit_not_cleared`. While it is `disposal proposed`, preview and download behave as for `cleared`, but saving marks, find, rendering and adding its derivative to a release answer `exhibit_not_cleared`. Adding a derivative whose exhibit is `disposed` also answers `exhibit_not_cleared`. A held exhibit can still be read, redacted and rendered.

**Clearing re-checks the seal.** After its role, proof and state checks, a clear reads the stored object in full and compares its size and SHA-256 with the sealed values. No database transaction and no ledger or row lock is held during that read. One transaction then locks the exhibit, checks its state again, consumes the proof and clears it.
- **Mismatch or missing object:** the answer is `seal_mismatch`. The exhibit stays `quarantined` and the proof stays unused. One transaction commits one `exhibit.seal_failed` entry and one new `seal_mismatch` signal targeting the exhibit. The entry's `detail` holds `sealed_sha256`, `sealed_size`, `found_sha256` and `found_size`, the found values null when the object is missing. The exhibit's `seal_check` becomes `failed`, and a later successful clear returns it to null.
- **Storage down:** `storage_unavailable`, proof unused, nothing written.
- **Refuse** does not read storage, so a damaged exhibit can still be refused during an outage.
- **Races:** of concurrent clears and refusals, one wins. The rest answer `illegal_transition` with their proofs unused.

**Legal holds.**
- An exhibit holds any number of holds, one per active matter. Matter references are compared exactly after trimming.
- Placing a hold under a matter that already has an active hold on this exhibit answers `hold_exists`.
- `hold_id` must name an active hold on this exhibit. Any other id, a lifted hold's id included, answers `not_found`.
- The exhibit returns to `cleared` only after the last active hold is lifted. A proposal a hold cancelled does not come back.
- Holds, lifts, proposals, confirmations, cancellations and item adds are serialised per exhibit across all running copies. No outcome leaves a disposed or cleared exhibit with an active hold, and the ledger order matches the order they took effect.

**Disposal.**
- **Propose:** moves `cleared` to `disposal proposed`, deletes nothing and writes `disposal.proposed`. It answers `exhibit_in_release` while a derivative of the exhibit is in a release that is not `withdrawn`. It needs no storage.
- **Confirm:** by a case lead with a full grant who did not propose it; the proposer gets `separation_of_duties`. Inside the per-exhibit serialisation, it checks that storage is reachable before deleting anything, deletes the original object, every derivative object and the saved regions, confirms each deletion in storage, and only then commits. Storage down, or a deletion that fails, answers `storage_unavailable`, the state stays `disposal proposed`, and a retry completes the disposal, treating objects already gone as deleted.
- **Cancel:** by any case lead with a full grant, returning to `cleared` and writing `disposal.cancelled`.
- **Hold during a proposal:** moves to `held`, with `disposal.cancelled` and `hold.placed` committed together. A confirmation that loses to a hold answers `legal_hold` and deletes nothing, so every object stays byte-identical. A hold that loses to a confirmation answers `illegal_transition`, and the exhibit is `disposed` with no active hold.
- **Afterwards:** rows and digests stay. The exhibit keeps its record at `GET /api/exhibits/{id}` with state `disposed`, and its derivatives answer with `disposed: true`. New preview and download grants answer `exhibit_not_cleared`, outstanding tokens answer `not_found`, and `GET` redactions returns an empty list with its last `marks_version`.
- **Break-glass:** on a held exhibit, a propose or confirm under break-glass answers `legal_hold`. Any other propose, confirm or cancel under break-glass answers `forbidden`.

**Registration.**
- The server streams the file to storage under a fresh key, confirms the stored size and SHA-256 by reading them back from storage, then commits the exhibit row and `exhibit.sealed` ledger entry in one transaction. The entry's `detail` carries the digest and size.
- If any step fails, or the connection drops before the request completes, the object is removed and no row or entry remains. Nothing is left in the bucket within 10 seconds of the drop.
- The response and every screen report `sealed` only after that confirmation.
- Registration reads only as much of a file as sniffing, page counting and the render limits need, and never decodes its pixels.

**Upload checks**, in this order:
1. A file name containing a path separator, `..` or a control character is refused.
2. A declared type or sniffed type not on the accepted list is refused.
3. A sniffed type that differs from the declared type is refused.
4. A `submitted_sha256` that differs from the computed digest is refused.

The accepted list is `application/pdf`, `image/png`, `image/jpeg`, `audio/wav` and `audio/mpeg`, judged by leading bytes. SVG and HTML are never accepted. A `declared_type` that is present but off the list answers only `errors.file` with the unaccepted-type copy, and no `errors.declared_type`. A `declared_type` that is missing or empty answers `errors.declared_type` with the required copy. A file with a PDF signature that cannot be read is still accepted and sealed, with `page_count` null. A PDF with a non-empty open password counts as unreadable; one that opens with an empty password is an ordinary PDF.

**Registration idempotency.** `Idempotency-Key` is scoped to the person and the endpoint, not to a session, so a registration that committed just before a session ended replays across the new session. It is also accepted on break-glass, with the same semantics.
- A repeat with the same request returns the stored status and body, with the header `Idempotent-Replay: true`, and creates nothing.
- A repeat with a different request (a different file digest or a different field) answers `idempotency_conflict`.
- Of concurrent requests with one key, exactly one takes effect, and the others replay it.
- Only successful responses are stored.

**Originals.** A sealed original is never changed. Metadata stripping happens only in derivatives. Downloading an original returns exactly the submitted bytes.

**Saved marks.**
- Regions are integers in thousandths of the displayed page: `x` and `y` from 0, `w` and `h` at least 1, `x+w` and `y+h` at most 1000. `page` must be within `page_count`.
- An exhibit's `marks_version` starts at 0 with no regions, and every save that changes the set raises it by one and writes one `redaction.saved` entry with the version in `detail`.
- A `PUT` whose `marks_version` is a whole number other than the current one answers `stale_marks`, whatever its regions hold. Of concurrent saves from one version, exactly one wins.
- A `PUT` with the current version and the same set of regions, in any order, answers 200, changes nothing and writes no entry.

**Finding text.**
- The find endpoint saves nothing and writes no ledger entry. The searched text never reaches the ledger or any table.
- Matching is case-insensitive against the page's text layer, and any run of white space matches any run of white space, line breaks included. A match answers one region per line it touches, in page order, then top to bottom, then left to right.
- Each region is the smallest box in whole thousandths of the displayed page that encloses the matched glyph boxes, with `x` and `y` rounded down and the right and bottom edges rounded up, clipped to the page. It uses the same displayed-page geometry as rendering, rotation and crop included.
- Text wholly outside the visible area is not a match.
- An image exhibit answers an empty list, unless it is over the render limits. Audio, unreadable files and files over the render limits answer `not_redactable`.

**Superseded derivatives.**
- A derivative records the `marks_version` it was rendered from, and is superseded once the exhibit's `marks_version` is higher. It never returns to current.
- Adding a superseded derivative to a release, or submitting, signing off, sharing or regenerating a link for a release holding one, answers `derivative_superseded` naming the release's lowest-numbered superseded item's derivative, after `illegal_transition` is checked.
- Rejecting such a release stays legal. An active link keeps working, and its items stay collectable until the link dies.

**Rendering.**
- Rendering works from the saved regions and the original and writes a new object. Audio or an unreadable file answers `not_redactable`, and a preview of one answers `not_previewable`.
- **The displayed page.** Everything is measured on the page as a reader sees it. A JPEG's EXIF orientations 1 to 8 are applied, with any other value treated as 1. A PDF page's `/Rotate`, whether set on the page or inherited, and its CropBox, including a non-zero origin and clipped to its MediaBox, are honoured. Visible annotations and filled form fields are drawn into the raster. Preview and render share this geometry.
- **Page size.** An image's displayed size is its pixel size after orientation. A PDF page is rendered at exactly 150 dots per inch, its displayed width and height being the visible area in points times 150/72, rounded up.
- **Fill.** Each saved region is filled solid black, exact (0, 0, 0), into the pixels. In each axis, where S is the displayed size in pixels, the fill starts at region start times S divided by 1000, rounded down, and runs up to but not including region end times S divided by 1000, rounded up.
- **PNG output, from any image exhibit.** 8-bit RGB, with only the chunks IHDR, IDAT and IEND, and the displayed size. Palette, greyscale, 16-bit and CMYK inputs are converted. Transparency flattens onto white, only the first frame of an animated PNG is used, and trailing bytes, ICC profiles, EXIF data and text chunks are dropped.
- **PDF output, from a PDF exhibit.** One page per source page, each showing one losslessly compressed page image. The file has no `/Info`, `/Metadata`, annotations, embedded files, text layer or other content beyond the document catalog, page tree, pages, their content streams and those images.
- **Reproducibility.** The same original and saved regions give byte-identical output on every render, with no dates or random ids in the file. Each render still makes a new derivative record and object.
- Zero regions is allowed and still rasterises.
- Only derivatives can enter a release. Marks are never released.

**Render limits.** An image above 40,000,000 pixels, a PDF with any page above 40,000,000 pixels at the page size above, or a PDF above 200 pages still registers and seals byte-identical, keeps its `page_count`, and answers `not_previewable` and `not_redactable`. Exactly 40,000,000 pixels or exactly 200 pages is allowed. While any preview or render runs, `GET /api/health` and `GET /api/session` answer within 2 seconds.

**Previews.** A preview grant yields one server-rendered PNG of one page of an exhibit, following the geometry and PNG output rules above. It is not stored. The redaction regions are not burned into it.

**Download grants.** A grant lasts 60 seconds and is claimed by one `GET /api/download/{token}`, for previews and for files alike. Of any number of concurrent requests, exactly one receives the file, and the others answer `not_found`. An unknown, spent or lapsed token answers `not_found`.
- The claim and its `download.claimed` entry commit once storage has opened the object. Bytes then stream outside any transaction, and a later stream failure leaves the grant spent. The entry's `detail` holds the digest as `sha256`, `exhibit_id`, `derivative_id` when the file is a derivative, and `kind` of `preview` or `file`.
- If storage cannot open the object, the answer is `storage_unavailable`, the claim is rolled back, and the same token still works from any running copy of the app until it lapses.
- An unclaimed token answers `not_found` at claim time if, since it was issued, the issuer's session ended, the issuer's grant ended, the issuer's scope no longer covers the file, the exhibit was disposed of, or, for a link grant, the link died.

**Grants.**
- Grant states are `active` to `revoked` or `lapsed`. Break-glass grants are `active` to `ended`.
- Every issue, edit and revocation on one compartment takes a per-compartment lock across all running copies and raises `access_version` by one. The caller's own grant is checked again after that lock is taken, and a caller who no longer has authority answers `not_found` with its denial entry.
- An issue or edit whose `access_version` is a whole number other than the current one answers `stale_access_list`. This is checked first, so an edit carrying an old `access_version` on a grant that is no longer active answers `stale_access_list`.
- A revocation of a grant of kind `grant` carries no version and is accepted against any newer state, so a revocation always holds, with the single published exception of `last_case_lead`. Revoking an inactive grant of kind `grant`, or editing one with the current `access_version`, answers `grant_not_active`.
- **Last case lead.** A revoke, a narrowing to `derivatives` or setting a non-null `expires_at`, on an active full grant of kind `grant` held by a case lead, answers `last_case_lead` if no other case lead would keep an active, full, non-lapsing grant of kind `grant` on that compartment. It leaves the proof unused. A `scope` or `expires_at` that fails validation changes nothing and answers validation. Of two leads revoking each other at once, exactly one succeeds and the other answers `not_found` with its denial entry.
- A grant whose `expires_at` has passed is refused from that moment on, and the API reads its `state` as `lapsed` from that instant. A sweep within 10 seconds writes `grant.lapsed`.
- A grant's lapse time is accepted, refused and ended only by the server's clock.
- Issuing to someone with an active grant answers `grant_exists`.
- A break-glass grant cannot be used to issue, edit or revoke grants or to end sessions, which answer `forbidden`.
- A grant of kind `break_glass`, active or ended, cannot itself be revoked or edited by anyone. `POST /api/grants/{id}/revoke` and `PATCH /api/grants/{id}` on one answer `forbidden`, whatever their `access_version`, with one `access.denied` entry and any proof left unused. An active one stays active, `access_version` does not change, and it ends only by itself.
- Revocation takes effect on that member's very next request.

**Break-glass.**
- A case lead with no active grant on the compartment may open it by id with a written reason. This is the one exception to the out-of-grant rule, and an unknown id still answers `not_found`.
- A lead with a normal grant gets `already_granted`, and one with an open break-glass gets `break_glass_active`. An investigator or intake officer gets the usual `not_found` or `forbidden`.
- It grants full scope and ends by itself after `BREAK_GLASS_SECONDS` (default 60 minutes, not settable by anyone in the product). There is no manual end and no renewal while it is active.
- After it ends, reads answer `not_found` at once, and a sweep within 10 seconds writes `break_glass.ended`.
- Replaying the opening key after the end returns the stored response and does not reopen access. A new opening under a new key is a new grant.
- The grant, the `break_glass.opened` ledger entry and the outbox notice commit in one transaction. A mail outage never blocks or loses the notice.
- A break-glass grant answers `forbidden` for sign-off, rejection, share, link revoke, link regenerate and withdraw.
- Every entry for an action or refusal in that compartment made under it carries `detail.via` of `break_glass` and `detail.grant_id`, a download claim included when the token was issued under it. The `break_glass.opened` and `break_glass.ended` entries target the grant and carry neither.

**Release states.**

| From | To | Action | Who |
|---|---|---|---|
| `assembling` | `submitted` | Submit | Assembler or contributor |
| `submitted` | `signed off` | Sign off | Case lead who is neither assembler nor contributor |
| `submitted` | `rejected` | Reject | Same as sign off |
| `rejected` | `assembling` | Reopen | Assembler |
| `signed off` | `shared` | Share | Case lead |
| `shared` | `withdrawn` | Withdraw | Case lead |

- Every other transition answers `illegal_transition`. State words in API bodies are exactly as written here.
- Item changes outside `assembling` answer `release_locked`. Submitting with no items answers `release_empty`.
- The creator is the assembler. Contributors are anyone who ever added an item, the person who rendered an added derivative, and the person who saved the marks it was rendered from. They stay contributors even after the item is removed.
- A derivative from another compartment answers `not_found`.
- Reopening someone else's release answers `forbidden`.
- Separation of duties is checked for every role and answers `separation_of_duties`.
- `total_bytes` is the sum of its items' derivative sizes.
- A compartment's `release_bytes` sums `total_bytes` across its releases, except withdrawn ones. `quarantine_count` counts its `quarantined` exhibits.
- Decisions write the ledger entry and outbox notice in one transaction. `notice` is `held` when this copy of the app's last mail check found the relay down, otherwise `queued`.

**Manifest digest.** A release's `manifest_digest` is the lower-case hex SHA-256 of the UTF-8 bytes of a JSON array holding `{"derivative_id","label","sha256"}` for each item, in item id order, serialised by the ledger's canonical form rules. An empty release's array is `[]`.
- A sign-off whose `manifest_digest` is a non-empty string other than the current digest answers `release_changed`, leaving the proof unused. A release changed through reject, reopen, edit and resubmit is back in `submitted` but has a new digest if its contents changed, so a stale view cannot approve it.
- Of any number of concurrent decisions on one release, exactly one wins, and the rest answer `illegal_transition`. There is one ledger entry and one outbox row.

**Opening every item.** A sign-off needs the deciding person to have a committed `download.claimed` for the derivative of every current item, from any of their sessions.
- A grant issued but never claimed, a claim rolled back by storage, and another person's claim do not count.
- Derivatives are immutable, so after reject, reopen and resubmit only newly added derivatives need opening.
- Otherwise the answer is `items_unopened`, listing the current items not yet opened, with the proof unused.
- Rejection has no such requirement.
- The `release.signed_off` entry's `detail` holds `manifest_digest` and `opened_items`, the list of item ids.

**Sharing.** Sharing and regenerating check every item's stored object against its recorded size in storage before committing anything. A missing or wrong-size object answers `derivative_missing`, and storage down answers `storage_unavailable`. Either answer changes nothing: a share leaves the release `signed off`, and a regenerate leaves the release `shared` with any active link still working. A release has at most one active link. Tokens are random and at least 32 characters.
- Revoke is legal only while the release is `shared` with an active link. It kills the link and leaves the release `shared`.
- Regenerate is legal only while the release is `shared`, with or without an active link. It issues a new token under a new `link_id`, kills any old link and leaves the release `shared`.
- A link action refused under either rule answers `illegal_transition` with `from` as the release's current state and `to` as `shared`, including a revoke on a shared release with no active link. Every other `illegal_transition` has `from` as the record's current state and `to` as the state the action would produce.
- Withdraw kills the link.
- An unknown, revoked, regenerated-away, lapsed or withdrawn token answers `not_found` from the API, and `/l/<token>` answers HTTP 404 with the same page for each.

**Collection throttle.** A link allows 10 collection grants in any 60 seconds. The 11th answers `throttled`, with `Retry-After` at most 60. Each burst that reaches the limit raises one `bulk_collection` signal and writes `collection.throttled`. The signal's `target` and the entry's `target` are the link's id, and the entry's actor is `link:<link id>`.

**Ledger: the Single ledger chain rule.**
- One table, `ledger_entries`, holds one chain for the whole deployment. Its columns are `seq` (bigint from 1, gapless), `at` (text, UTC, microseconds, as `2026-10-30T12:00:00.000000Z`), `actor_id` (text), `session_id` (text, nullable), `action` (text), `target` (text), `detail` (jsonb holding no fractional numbers), `prev_digest` (text) and `digest` (text).
- Appends are serialised across all running copies of the app, so the chain never forks. An append takes the last row's stored `digest` as its previous digest.
- **Canonical form:** the JSON of exactly `action`, `actor_id`, `at`, `detail`, `seq`, `session_id`, `target`, with keys sorted at every depth, no whitespace, non-ASCII characters left as UTF-8, and `session_id` as `null` when absent. Only quote, backslash and characters below U+0020 are escaped, with the short forms `\b`, `\t`, `\n`, `\f` and `\r` and lower-case `\u00xx` for the rest. Keys in `detail` are plain ASCII.
- **Free text** enters `detail` exactly as typed after trimming, with no Unicode normalisation. The digest the server stores, a digest computed independently from the published form, and the browser's digest all agree for any storable text, including decomposed accents, emoji, U+2028, quotes, backslashes, tabs and line feeds.
- **Digest:** lower-case hex SHA-256 of the UTF-8 bytes of `<previous digest>`, one line feed, then the canonical form. Link 1's previous digest is 64 `0` characters.
- **Breaks.** The walk applies the tests below to each link in order and stops at the first that fails. "Computed" means the value the browser computed, with each link chained from the browser's own computed digest of the link before, never from a stored digest. A digest cell has `data-differs="true"` where its character differs from the same position of the compared value, and the first such cell also has `data-first-break="true"`. A remembered link is the browser's own remembered high-water link or any anchor added to it.

| Test, in this order | Link named | Cells show | Compared with |
|---|---|---|---|
| The next row's `seq` is not the previous `seq` (0 before link 1) plus one | The previous `seq` plus one | 64 `-` characters | Nothing; all 64 cells differ |
| The stored `digest` differs from this link's computed digest | This link | This link's computed digest | The stored `digest` |
| The stored `prev_digest` differs from the previous link's computed digest | This link | The previous link's computed digest | The stored `prev_digest` |
| This is a remembered link, and its computed digest differs from the remembered digest | The remembered link | This link's computed digest | The remembered digest |

- The chain ending is not a break unless the browser remembers a link beyond its end. In that case, as soon as the last link verifies, the walk names the first missing number, with cells as in the table's first row. The head moves onto that number, the slider maximum rises by one to hold it, and `<count>` stays the chain's link count.

**Custody history.**
- An entry belongs to an exhibit when its `target` is the exhibit or one of its derivatives, or its `detail.exhibit_id` names the exhibit. The actions that carry `detail.exhibit_id` are in the Ledger targets table.
- The endpoint returns stored entries unchanged, in `seq` order, and pages by `seq`, so a page never skips or repeats an entry while new entries arrive.
- It stays readable after disposal, and reading it writes no entry.

**Attribution.** Every state change, and every refusal listed under Denials, writes exactly one entry in the same transaction. There are two published exceptions: creating a compartment writes `compartment.created` and then `grant.issued` for the owner's full grant, both in one transaction, and a hold placed during a disposal proposal writes `disposal.cancelled` and `hold.placed`, both in one transaction. `actor_id` is a person's id, `link:<link id>` for a link holder, or `system` for sweeps and seed. `session_id` is the session id, or null for link holders and `system`. `target` follows the Ledger targets table, except where Denials, Malformed input, Sign-in limits, Collection throttle and Break-glass define it. `detail` never holds exhibit names, provenance or file content. Exhibit digests and sizes, matter references and written reasons are allowed.

**Ledger targets.**

| Actions | `target` | `detail` also holds |
|---|---|---|
| `session.opened`, `session.closed` | That session's `session_id` | |
| `session.revoked` | The person whose sessions ended, with one entry per request even when none were open | `revoked`, the number ended |
| `compartment.created` | The compartment | |
| `grant.issued`, `grant.edited`, `grant.revoked`, `grant.lapsed` | The grant | `compartment_id`, `user_id` |
| `exhibit.sealed`, `exhibit.cleared`, `exhibit.refused`, `exhibit.seal_failed`, `redaction.saved`, `disposal.proposed`, `disposal.cancelled`, `exhibit.disposed` | The exhibit | |
| `hold.placed`, `hold.lifted` | The exhibit, never the hold | `hold_id`, `matter_ref` |
| `derivative.rendered` | The derivative | `exhibit_id` |
| `release.created`, `release.submitted`, `release.signed_off`, `release.rejected`, `release.reopened`, `release.withdrawn` | The release | |
| `release.shared` | The release | `link_id` |
| `release.item_added`, `release.item_removed` | The release | `item_id`, `derivative_id`, `exhibit_id` |
| `link.revoked`, `link.regenerated` | The release, never the link | `link_id`: the link revoked, or the new link issued |
| `download.claimed` | The derivative for a derivative file, otherwise the exhibit | As stated under Download grants, `exhibit_id` included |

**Ledger action names:**
- Sessions and sign-in: `session.opened`, `session.closed`, `session.revoked`, `signin.locked`
- Denials: `access.denied`
- Compartments and grants: `compartment.created`, `grant.issued`, `grant.edited`, `grant.revoked`, `grant.lapsed`
- Break-glass: `break_glass.opened`, `break_glass.ended`
- Exhibits: `exhibit.sealed`, `exhibit.cleared`, `exhibit.refused`, `exhibit.seal_failed`, `hold.placed`, `hold.lifted`, `disposal.proposed`, `disposal.cancelled`, `exhibit.disposed`, `redaction.saved`, `derivative.rendered`
- Releases: `release.created`, `release.item_added`, `release.item_removed`, `release.submitted`, `release.signed_off`, `release.rejected`, `release.reopened`, `release.shared`, `release.withdrawn`
- Links and collection: `link.revoked`, `link.regenerated`, `collection.throttled`
- Downloads: `download.claimed`

**Ledger protection.** On every start, the server removes UPDATE, DELETE and TRUNCATE on `ledger_entries` from the application login and from everyone else, and installs triggers refusing all three. The provided login owns the database and has no right to create roles, so a separate role is used only if the login is able to create one. A plain `UPDATE`, `DELETE` or `TRUNCATE` with `DATABASE_URL` must fail with a database error. Someone who deliberately re-grants themselves rights and disables the triggers is working below the application, and the Chain Walk exists to catch that. The server never repairs or hides such a change.

**Timers**

| Rule | Environment variable | Default |
|---|---|---|
| Sign-in lockout | `LOCKOUT_SECONDS` | 300 seconds |
| Step-up proof life | `STEP_UP_TTL_SECONDS` | 300 seconds |
| Session life | `SESSION_TTL_SECONDS` | 43,200 seconds |
| Session idle period | `SESSION_IDLE_SECONDS` | 3,600 seconds |
| Break-glass length | `BREAK_GLASS_SECONDS` | 3,600 seconds |

### Services (DP-10, DP-11, DP-40, DP-52, DP-59, DP-68, DP-74, DP-76, DP-77, DP-78, DP-80)

**PostgreSQL** holds exhibits, grants, sessions, the ledger and the mail outbox. The outbox table is `mail_outbox`, with columns including `recipient`, `subject` and `status`, where `status` is `pending` or `sent`. An unreachable database at boot is retried until it answers.

**MinIO** holds originals at `originals/<random hex of at least 32 characters>` and derivatives at `derivatives/<random hex of at least 32 characters>`. Keys never contain exhibit names or file names. No presigned URL or public object is ever issued, and bytes reach clients only through the server after a grant is claimed.

**Down behaviour:** storage-dependent actions (register, clear, confirm disposal, preview, find, render, download, share, regenerate, collect) answer `storage_unavailable` with the outage copy from Feedback states and change nothing. Sign-in, reading records and the ledger, grants, holds, refuse, propose and cancel disposal, sign-off, rejection, reopening, item changes that use recorded sizes, custody history and link reads all keep working.

**Storage status.** `storage` in `GET /api/status` is `up` only when an authenticated check of the bucket succeeds. Wrong credentials count as down, exactly like an unreachable endpoint: the banner shows, storage-dependent actions answer `storage_unavailable` with their outage copy, no request answers a 500, and sign-in and record reads still work.

**Mailpit** receives mail over SMTP. From is `Wardline Custody <custody@ashgrove.example>`, read from `MAIL_FROM`. Mail is never sent inside the request that caused it. A background worker in each running copy of the app claims `pending` rows, so one row is sent once across copies. It tries at least every 5 seconds and delivers within 30 seconds of the relay being reachable. A failed send returns the row to `pending`.

Break-glass notice, to the compartment owner, with subject `Break-glass access opened on <compartment id>` and this text body:

```
Break-glass access opened.
Actor: <actor name>
Reason: <reason>
Compartment: <compartment id>
```

In this mail only, each run of line feeds, U+0085, U+2028 or U+2029 in `<reason>` becomes one space, so a reason can never forge a line of the notice. The ledger keeps the reason as typed. The mail body is UTF-8.

Release decision notice, to the assembler, with subject `Release <release id> signed off` or `Release <release id> rejected` and this text body:

```
Release <release id> was <signed off or rejected> by <reviewer name>.
Open Wardline to read the decision.
```

Neither mail contains exhibit names, provenance, compartment names, rejection reasons or file content.

**Status checks.** Each running copy of the app checks storage and the SMTP relay at least every 5 seconds and reports the result at `GET /api/status`. A failed check changes the banner. Requests also never wait more than 5 seconds on an unreachable dependency.

### Seed data (DP-97)

Every seeded person and business is invented. Every seeded person's password is `Custody-Seed-2026!`.

| Id | Name | Email | Role | Authenticator secret (base32) |
|---|---|---|---|---|
| USR-01 | Tamsin Oduya | `tamsin.oduya@ashgrove.example` | case_lead | `TAMSINODUYA2WARD` |
| USR-02 | Rafael Lindqvist | `rafael.lindqvist@ashgrove.example` | case_lead | `RAFAELLINDQ3WARD` |
| USR-03 | Ines Marlow | `ines.marlow@ashgrove.example` | intake_officer | `INESMARLOW4WARDL` |
| USR-04 | Kofi Brandt | `kofi.brandt@ashgrove.example` | intake_officer | `KOFIBRANDT5WARDL` |
| USR-05 | Mbali Serrano | `mbali.serrano@ashgrove.example` | intake_officer | `MBALISERRANO6WRD` |
| USR-06 | Noor Halloran | `noor.halloran@ashgrove.example` | investigator | `NOORHALLORAN7WRD` |
| USR-07 | Dmitri Vance | `dmitri.vance@ashgrove.example` | investigator | `DMITRIVANCE2LINE` |
| USR-08 | Yuki Castellan | `yuki.castellan@ashgrove.example` | investigator | `YUKICASTELLAN3WD` |
| USR-09 | Sefa Whitlock | `sefa.whitlock@ashgrove.example` | auditor | `SEFAWHITLOCK4WRD` |

| Compartment | Name | Owner | Active grants |
|---|---|---|---|
| CMP-0001 | Harrowgate Depot Payments | USR-01 | Full: USR-01, USR-02, USR-03, USR-04, USR-06 |
| CMP-0002 | Saltmarsh Witness Statements | USR-02 | Full: USR-02, USR-04, USR-05, USR-07 |
| CMP-0003 | Eastbank Tender Records | USR-01 | Full: USR-01, USR-03. Derivatives: USR-08 |

All seeded grants have no lapse time.

| Exhibit | Compartment | Name | State | Registered by | Cleared by | Marks version | Bytes |
|---|---|---|---|---|---|---|---|
| EX-0001 | CMP-0001 | Harrowgate payment ledger scan | cleared | USR-03 | USR-04 | 1 | One-page PDF with the text `HARROWGATE-PAYEE-7731` and document author `Harrowgate Archive Desk` |
| EX-0002 | CMP-0001 | Depot gate photograph | cleared | USR-04 | USR-03 | 1 | PNG of 800 by 600 pixels, with a text chunk `Camera=Gatehouse-2` |
| EX-0003 | CMP-0001 | Anonymous courier note | quarantined | USR-03 | none | 0 | One-page PDF with the text `COURIER-NOTE-0093` |
| EX-0004 | CMP-0002 | Saltmarsh witness recording 14 | cleared | USR-05 | USR-04 | 0 | One second of silent WAV audio |
| EX-0005 | CMP-0002 | Saltmarsh boat manifest | held | USR-05 | USR-04 | 0 | One-page PDF with the text `SALTMARSH-WITNESS-2208` |
| EX-0006 | CMP-0003 | Eastbank tender export | cleared | USR-03 | USR-01 | 0 | One-page PDF with the text `EASTBANK-TENDER-5510` |

Provenance for each seeded exhibit: source `Seed record`, collected by the registering officer's name, collected on `2026-09-14`, and no capture notes.

EX-0005 holds one active hold: `HLD-0001`, under matter `M-2026-077`, placed by USR-02, with reason `Seed hold for matter M-2026-077`.

| Derivative | From | Created by | Marks saved by | Marks version | Saved regions |
|---|---|---|---|---|---|
| DV-0001 | EX-0006 | USR-01 | none | 0 | None |
| DV-0002 | EX-0002 | USR-06 | USR-06 | 1 | One on page 1 at x 100, y 100, w 400, h 300, in thousandths of the page |
| DV-0003 | EX-0001 | USR-06 | USR-06 | 1 | One covering the whole page |

| Release | Compartment | Name | Matter | Recipient | State | Assembler | Signed off by | Items |
|---|---|---|---|---|---|---|---|---|
| REL-0001 | CMP-0001 | Harrowgate disclosure to counsel | M-2026-041 | counsel | shared | USR-06 | USR-01 | ITM-0001: DV-0002 labelled `Gate photograph, redacted` |
| REL-0002 | CMP-0001 | Harrowgate public disclosure | FOI-2026-118 | requester | submitted | USR-06 | none | ITM-0002: DV-0003 labelled `Payment ledger, redacted` |

REL-0001 has an active link with token `harrowgate-counsel-seed-link`, stored hashed like any other, lapsing on `2036-01-01T00:00:00Z`. No seeded person has a download claim, so REL-0002's reviewer must open its item before signing off.

Seeded records go through the ledger under actor `system` and null session, at least one entry each, with each exhibit's and derivative's id as its entry's `target`. New ids continue each series with four digits.

Seeding is idempotent and safe when several copies start at once. Seed objects are written to storage only if their records are missing. If storage is down at boot, seeding of objects is retried in the background and a row appears only after its object is confirmed.

## Technical requirements

### Deployment (DP-97)

Python 3 is available. Provide `/app/run.json` with string `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. The app is installed and run as an unprivileged user: dependencies go into a `.venv` inside `/app`, and the manifest calls its tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`. For example:

```json
{
  "_schema": "run-manifest-v1",
  "install": "python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt",
  "build": ".venv/bin/python -m compileall -q .",
  "serve": ".venv/bin/python -m wardline"
}
```

Bind `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` once the schema is applied. Until the database first answers, it answers HTTP 503 `{"status":"starting"}`.

Several copies of the app may run against one database and bucket at once. Every lock, single-claim rule, outbox claim and ledger append must hold across processes. Apply the schema and seed idempotently on every start.

### Configuration and secrets (DP-98)

Read these from the environment at start:

- **Database:** `DATABASE_URL`
- **Storage:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- **Mail:** `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (when unset, use the From line in Services)
- **Serving:** `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`
- **Timers:** `LOCKOUT_SECONDS`, `STEP_UP_TTL_SECONDS`, `SESSION_TTL_SECONDS`, `SESSION_IDLE_SECONDS`, `BREAK_GLASS_SECONDS`

Never hard-code a credential or send one to the browser. Create the bucket named by `S3_BUCKET` if it does not exist, and treat a refusal to do so as a storage outage.

### Server boundary (DP-18, DP-20, DP-60, DP-64, DP-78, DP-98)

- Serve everything from one origin, with no third-party scripts, styles, fonts or requests. A state-changing request whose `Origin` header names another origin answers `forbidden_origin`. A request with no `Origin` header is allowed.
- The request limits are those in API.
- Paths such as `/.env`, `/run.json`, `/.git/config` and any source file answer HTTP 404.
- Every file from `GET /api/download/{token}` has `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and its sniffed type, and the download file name is built from the record id and digest, never the submitted name. API responses also send `X-Content-Type-Options: nosniff`.
- `/l/<token>`, every response under `/api/links/` and every response from `GET /api/download/{token}` send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- **Transfers.** At least 40 stalled transfers at once, in either direction, leave every other request answering within 2 seconds, including ones that append to the ledger. Files are never held whole in memory, and a transfer or a clear's seal read holds no database transaction or ledger lock while bytes move. A transfer whose client closes or drops releases its database and storage resources within 10 seconds, and one that makes no progress for 30 seconds is closed and treated the same way.
- A storage or mail relay that is unreachable at boot does not stop the server. It starts, answers health, shows the outage banner, and recovers when the dependency returns, with no restart.

### Browser support and performance (DP-28, DP-83, DP-86, DP-88, DP-90)

Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with touch at the first two. A signed-in screen is usable within three seconds on the seed data. The browser hashes 1,000 links in under two seconds. On a chain of 2,500 links, pressing End reaches a verified-through value of 2,500 within 10 seconds, and the lattice reaches its verdict within 10 seconds of arrival. An orbit key press changes the camera attributes within a quarter of a second. Web Crypto needs a secure context, and an address on this machine or over HTTPS provides it. Anywhere else, the walk and the lattice show the no-Web-Crypto copy and give no verdict, and collection saves with the digest-not-checked copy.

## Working rules

- IF-01: `/app/run.json` has string `install`, `build` and `serve` keys and `"_schema":"run-manifest-v1"`, and its commands call Python tools through `.venv/bin/<tool>` or `python -m <tool>`.
- IF-02: `THIRD_PARTY_NOTICES.md` at the `/app` root lists every shipped package, bundled browser library and bundled font with its licence.
- IF-03: Shipped packages, meaning every package the manifest's `install` command puts into `/app/.venv`, as listed by `.venv/bin/python -m pip list` (excluding `pip`, `setuptools` and `wheel`), and every bundled browser library, use only MIT, MIT-CMU, HPND, BSD, Apache-2.0, ISC, PSF, MPL-2.0 or LGPL licences; bundled fonts use OFL-1.1.
- IF-04: The product stores data only in the provided PostgreSQL and MinIO, with no SQLite, Redis or other datastore, and no durable state on local disk.
- IF-05: Dev service configuration and seeded credentials supplied with the environment stay unchanged.
- IF-06: No file in `/app` holds a literal credential for a service other than the seed people's published values.

## Engineering standards

- The Python is idiomatic with type hints at public boundaries, and names match this brief's domain terms: exhibit, compartment, grant, derivative, release, step-up, ledger, custody.
- Each domain rule, such as an exhibit transition, a release transition, the separation-of-duties check or the canonical digest, is decided in exactly one place in the server source, and the browser's canonical form is shared by the walk, the lattice and the custody check.
- No abstraction exists with only a single implementation.
- There is no dead, commented-out or unreachable code, and no defensive checks for states that cannot happen.
- All API errors go through one error shape, as published in the error catalogue.
- Multi-step writes use database transactions, with no background retry standing in for atomicity.
- The source contains no features beyond this brief.
