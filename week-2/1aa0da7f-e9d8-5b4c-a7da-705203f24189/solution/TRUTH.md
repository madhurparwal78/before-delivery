# TRUTH

The brief made concrete, never reinterpreted. Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>`. `DESIGN.md` holds the full token and enhancement tables; this file is the behaviour the build must show.

Provider names: **PG** is PostgreSQL (`ledger_entries`, `mail_outbox` and the records), **MinIO** holds `originals/<hex>` and `derivatives/<hex>`, **Mailpit** receives mail from `Wardline Custody <custody@ashgrove.example>`. Source for all three: brief: Services. Seed values: brief: Seed data. Password for every seeded person: `Custody-Seed-2026!`.

## Journeys

Copy, regions, ledger actions and routes in this section are `brief:` as named on each journey's source line, unless marked `decided:`.

### 1. Registering an exhibit

Source: brief: Journeys, Interactions (Registration, Sign in again), Feedback states, Business rules (Registration).

| Step | State |
|---|---|
| Start | Ines Marlow signed in on `/intake` (her landing). Figure: her quarantine count. `form "Register exhibit"` empty, `table "Quarantine"` listing rows from her full-grant compartments |
| Action | Chooses `combobox "Compartment"`, fills `Exhibit name`, `Source`, `Collected by`, `Collected on`, optional `Capture notes`, `combobox "Declared type"`, file input `File`, optional `Submitted digest`; presses `button "Register exhibit"` |
| During | `progressbar "Upload progress"` fills from bytes actually sent, staying below 100 while bytes remain. `status "Intake status"`: `Uploading 0 percent.`, 25, 50, 75, 100, each once in order, then `Confirming storage.`. Further presses and Enter send nothing |
| Visible end | `Sealed <exhibit id>. In quarantine until a second officer clears it.` Form empties except the compartment. New `table "Quarantine"` row: id link, full 64-character digest in mono, green closed link mark with `data-seal-mark`, `Clear` and `Refuse` buttons |
| Provider end | MinIO `originals/<hex>` byte-identical to the file, size and SHA-256 read back. PG: exhibit row `quarantined`; one `exhibit.sealed` entry targeting the exhibit, with digest and size in `detail` |
| Connection lost | `Connection lost. Press Register exhibit to try again; it will not create a second exhibit.` Values and file stay; the `Idempotency-Key` is unchanged until an edit or a success. One more press finishes, with one row and one object |
| Session ended | `dialog "Sign in again"` above the form, email read-only, focus on password. On success the same request resends once with the same key; announcements restart |
| Refused | Focus to `alert "There is a problem"`, one link per field in vermilion with an icon; each field's copy below its control |
| Outage | `Not registered. Exhibit storage is unreachable, and nothing was kept. Try again when the notice clears.` Values, file and message survive every check. Nothing is left in the bucket |

### 2. Clearing quarantine

Source: brief: Journeys, Interactions (Step-up, Quarantine focus), Feedback states, Mandatory requirements DP-20.

| Step | State |
|---|---|
| Start | Kofi Brandt on `/intake`, EX-0003 quarantined in CMP-0001, registered by Ines Marlow |
| Action | Reads digest, opens the link to read provenance, presses `button "Clear EX-0003"`, completes `dialog "Step-up"` |
| During | `status "Action status"`: `Clearing.` Server re-reads the stored file with no transaction or lock held |
| Visible end | `Cleared EX-0003.` Row leaves; focus moves to next row's `Clear`, else the new last row's, else the table. The compartment's `data-quarantine-count` falls for watchers within 5 seconds |
| Provider end | PG: exhibit `cleared`, cleared-by recorded, one `exhibit.cleared`, proof consumed. MinIO object unchanged |
| Seal mismatch | `Not cleared. The stored file no longer matches its seal.` in vermilion; row shows an icon and `Seal failed`; exhibit stays quarantined and proof unused. PG: one `exhibit.seal_failed` and one signal, visible in `table "Signals"` |
| Own exhibit | `You registered this exhibit, so another officer must decide it.` |
| Lost a race | `Already decided by someone else.` and the focus fallback |

### 3. Controlling access

Source: brief: Journeys, Interactions (Grant dialogs, Live refreshes, Grant changes), Feedback states, Update delays.

| Step | State |
|---|---|
| Start | Tamsin Oduya on `/compartments/CMP-0001` with `table "Access list"`; Noor Halloran on `/exhibits/EX-0002` in another browser |
| Action | `button "Revoke grant for Noor Halloran"`, or `Edit grant for <name>` with `combobox "Scope"` and `textbox "Lapses at"` (plain text, empty sends null, never checked by browser clock), then step-up |
| Visible end, lead | `Grant revoked.` or `Grant saved.` Only the changed row is replaced; focus and scroll stay. Lapse text `Lapses <lapse> UTC` or `Does not lapse`, API state word on every row. No vermilion on a revoked or lapsed row |
| Visible end, investigator | Within 5 seconds. Ended: dialogs close, every digest, provenance value, preview, table and control of that compartment leaves both panes, its nav link goes, `alert "Access ended"` reads `Your access to this compartment has ended.` and takes focus; no further checks of it. Narrowed: provenance, preview, regions, `Download original` and custody surfaces leave, `table "Derivatives"` stays, `alert "Access changed"` shows and takes no focus |
| Provider end | PG: `grant.revoked`, `grant.edited` or `grant.lapsed`, targeting the grant with `compartment_id`, `user_id`; `access_version` rises; the very next read by that member answers not found with `access.denied` |
| Last lead | `This compartment needs another case lead with full access first.` Nothing changes |
| Stale write | Step-up closes, grant dialog stays with typed values and focus on `Save grant`, `Someone else changed this access list. Review it and try again.`; a second save succeeds |

### 4. Redacting

Source: brief: Journeys, Interactions (Redaction, Preview pages, Working regions), Feedback states, Mandatory requirements DP-39 to DP-47.

| Step | State |
|---|---|
| Start | Noor Halloran on `/exhibits/EX-0001`: `Loading preview.`, then `Preview loaded.`; `img "Exhibit preview page 1"` painted from a single-use grant, id as figure, digest below it |
| Action | `button "Add region"` adds x 100, y 100, w 200, h 100 in thousandths and focuses it; arrows move 10, Shift+arrow resizes 10 from right or bottom, not below 10, Delete removes; drag draws, moves and resizes; `textbox "Find text"` with `button "Mark matches"` adds unsaved regions |
| During | Each change: `Region <n> at <x>, <y>, size <w> by <h>.` Regions have a 2px ink outline, no vermilion. Rendering before saving: `Save your marks before rendering.` and nothing is sent |
| Save and render | `Marks saved.`, then `Rendering.`, then `Rendered <derivative id>.` New row in `table "Derivatives"` with its own digest; older one shows an icon and `Superseded` after newer marks |
| Provider end | PG: `redaction.saved` targeting the exhibit, version rises; `derivative.rendered` targeting the derivative with `exhibit_id`. MinIO: new `derivatives/<hex>`, rasterised, marks burned in, no covered text or metadata; original byte-identical. Find writes nothing |
| Stale save | `Someone else changed these marks. Review them and try again.` Working regions stay; adopts current `marks_version`; second save succeeds |

### 5. Releasing

Source: brief: Journeys, Interactions (Sign-off, Opening items), Business rules (Release states, Opening every item, Sharing), Services.

| Step | State |
|---|---|
| Start | Noor Halloran on `/compartments/CMP-0001`; `New release` dialog, `Release name`, `Matter reference`, `Recipient` |
| Assemble | On the release page: `combobox "Derivative"`, `Item label`, `Add item` gives `Item added.`; `Submit release` with step-up gives `Submitted <release id>.` |
| Review | Rafael Lindqvist's `/reviews`: row joins within 5 seconds, `status "Review queue count"` reads `<n> waiting for a decision.`, figure is the count. Opens `/releases/<id>`, `button "Open <label>"` downloads with the page staying; within 5 seconds the row shows green icon and `Opened` |
| Sign off | Step-up captures the manifest digest when it opens. `Signed off <release id>. Assembler notice queued.` Page is `/releases/<id>`, `status "Release state"` reads exactly `Signed off` |
| Share | `Share`, `Link lapses at`: `Confirming derivatives.`, then `Shared <release id>. Every derivative is confirmed present.` `link "Share link"` holds the full address until the page is left |
| Provider end | PG: `release.created`, `release.item_added`, `release.submitted`, one `download.claimed` per opened item, `release.signed_off` with `manifest_digest` and `opened_items`, `release.shared` with `link_id`; token stored only as a digest. `mail_outbox`: one row in the decision's transaction. Mailpit: subject `Release <release id> signed off` to the assembler, body with no exhibit names, reasons or file content |
| Refusals | `You worked on this release, so someone else must decide it.`; `Open every item before signing off. Not opened yet: <count>.`; `This release changed while you were reviewing it. Review it again.`; each leaves the proof unused and shows in vermilion |

### 6. Collecting through a link

Source: brief: Journeys, Interactions (Collecting), Feedback states, Business rules (Sharing, Collection throttle), Server boundary.

| Step | State |
|---|---|
| Start | No account. `/l/harrowgate-counsel-seed-link`: no carbon bar, one column, heading `Disclosure for matter M-2026-041`, item count as figure, `list "Release items"` |
| Action | `button "Collect Gate photograph, redacted"` |
| During | `Preparing Gate photograph, redacted.` Grant, blob, browser SHA-256 compared with item `sha256` |
| Visible end | `Collected Gate photograph, redacted. Digest matches.` in deep green; file saved |
| Provider end | PG: `download.claimed` targeting the derivative, with `sha256`, `exhibit_id`, `derivative_id`. Link changes nothing else. Responses carry `Referrer-Policy: no-referrer` and `Cache-Control: no-store` |
| Failed digest | `This file failed its digest check. Nothing was saved.` in vermilion |
| Throttled | 11th grant in 60 seconds: `Collection paused. Try again in <seconds> seconds.`; PG: `collection.throttled` and one `bulk_collection` signal |
| Dead link | Revoked, regenerated, lapsed or withdrawn: same address answers HTTP 404, figure `404`, heading `Nothing to show at this address.` |

### 7. Break-glass, hold and disposal

Source: brief: Journeys, Business rules (Break-glass, Disposal), Feedback states, Services.

| Step | State |
|---|---|
| Start | A case lead with no grant, on `/compartments` |
| Break-glass | `Compartment reference`, `Break-glass reason` (at least 20 characters), `Open break-glass`, step-up without a reason field. `Break-glass open until <time>. Owner notice queued.` `status "Break-glass time"` reads `Break-glass ends at <time>.` in ink mono, from the server's `ends_at` in UTC |
| Limits | May place a hold. Sign-off, rejection, share, link actions, withdraw and disposal actions are refused or absent |
| End | After `BREAK_GLASS_SECONDS` (default 60 minutes), every open page shows `alert "Access ended"` within 5 seconds, whatever the browser's clock |
| Provider end | PG: grant, `break_glass.opened` and outbox row in one transaction; later `break_glass.ended` within 10 seconds of the end; entries under it carry `detail.via` and `detail.grant_id`. Mailpit: subject `Break-glass access opened on <compartment id>` to the owner, line breaks in the reason flattened to one space |
| Hold | `Hold matter`, `Place hold`, reason in step-up: `Hold placed.` `[data-held-marker]` with icon and `Held` in vermilion on the row and screen. `Hold lifted.` or `Hold lifted. Other holds remain: <count>.` PG: `hold.placed`, `hold.lifted` with `hold_id` and `matter_ref` |
| Disposal | First lead `Dispose`: `Disposal proposed for <exhibit id>. Another case lead must confirm it.` Second lead `Confirm disposal`: `Disposed <exhibit id>.` Proposer confirming: `You proposed this disposal, so another case lead must confirm it.` |
| Disposal, provider end | MinIO: original and every derivative object gone, confirmed before commit. PG: saved regions gone, rows and digests stay, state `disposed`; `disposal.proposed`, `exhibit.disposed` |
| Hold during proposal | Moves to `held`, with `disposal.cancelled` and `hold.placed` together; a losing confirm deletes nothing and shows `Under legal hold. This exhibit cannot be disposed of.` with hold icon and word |

### 8. Proving the ledger and reading custody

Source: brief: Journeys, Interactions (Chain Walk, Anchors, Chain lattice, Custody check, Custody timeline), Business rules (Single ledger chain rule), Feedback states.

| Step | State |
|---|---|
| Start | Sefa Whitlock lands on `/ledger`. Head at link 0, `data-verified-through="0"`, `data-link-state="idle"`, `data-digest-state="settled"`, 64 `0` cells, figure `0`, `Start of the chain.` |
| Walk | Slider arrows step 1, Page keys 10, Home, End; drag; 72 pixels of page scroll per link. Browser hashes every link up to the head with Web Crypto, never taking a verdict from the server. Cells settle, mark closes with green check and `Verified`, numeral climbs, `Link <n> verified.` Moving back shows the earlier digest and keeps the numeral |
| Anchor | `button "Copy anchor"`: `Anchor copied.` Value `wardline-anchor:v1:<n>:<digest>`. `button "Check anchor"` runs locally and sends nothing |
| Break | Head stops at N, `data-verified-through` N minus 1, `data-link-state="broken"`, differing cells fill vermilion, first has a 3px ink outline and `data-first-break`, mark shows cross and `Break`, rail text `Break at link <n>`, `Break at link <n>.` |
| Lattice | `/audit/chain` reads every page, `Verifying links.`, then `All <count> links verified.` or `Break at link <n>. <faulted> links drawn in fault.` Idle turn until first input. Camera 30, 20; arrows 5 degrees, drag half a degree per pixel, `Reset view` |
| Custody | `/ledger/review`: `textbox "Exhibit id"`, `button "Show custody"`, `Checking custody.`, then `<n> entries checked. All match their digests. Run Chain Walk to prove the whole chain.` Each row check and green `Verified`, or cross and vermilion `Altered`. Unknown: `No exhibit with this id.` |
| Timeline | Case lead on `/exhibits/<id>`: `region "Custody timeline"`, fill and stops follow scroll, keys and `N`/`P`; `button "Entry details"` opens `dialog "Custody entry"` with stored fields in mono |
| Provider end | PG: `session.opened` at sign-in. The walk, lattice and custody check only read; no digest or anchor ever leaves the browser. Preview claims and downloads made elsewhere add custody entries |

## Palette roles

| Role | Hex the build uses | Contrast | Source |
|---|---|---|---|
| Paper, page ground and canvas ground | `#F1EEE6` | ink on it 15.93:1 | brief: Measured values, rgb(241,238,230) |
| Ink, type, rules, ordinary button, focus, fills | `#14140F` | paper on it 15.93:1 | brief: Measured values, rgb(20,20,15) |
| Vermilion, only the DESIGN.md allowlist | `#C8321A` | on paper 4.61:1; paper on it 4.61:1 | brief: Measured values, rgb(200,50,26) |
| Deep green, verified | `#1F5C45` | on paper 6.77:1 | brief: Measured values, rgb(31,92,69) |
| Carbon, top bar and Service notice | `#23231C` | paper on it 13.63:1 | brief: Measured values, rgb(35,35,28) |
| Muted | `#565550` | on paper 6.44:1 | decided: secondary text in AA |
| Button hover, press, disabled | `#3C3B36`, `#52514B`, `#686761` | paper on them 9.68, 6.87, 4.89:1 | decided: "a change of tone"; all clear AA |
| Skeleton | `#E4E1D9` | holds no text | decided: static loading blocks |
| Bar control rule | `#9F9D95` | on carbon 5.82:1 | decided: ink buttons must read on carbon |

## Type

| Use | Face, weight, size / line height | Source |
|---|---|---|
| `[data-figure]` | Martian Mono 700, `min(--figure-max, 100cqi / (chars x .665))` / 1, tracking -0.04em | brief: Measured values; fit decided |
| `--figure-max` | 120px at 1200 and wider, 100px at 768 to 1199, 72px below | decided: ratios 10.0, 8.33, 6.0 |
| `[data-figure-label]` | Martian Mono 400, 12px / 16px | brief: Measured values; size decided, 13px cannot fit `EX-0001` at 1280 |
| Ids, digests, counts, bytes, times | Martian Mono 400, 12px or 13px | brief: Visual design, Type; sizes decided |
| Body, small, control | Instrument Sans 400 15/22, 400 13/18, 600 14/1 | brief: Visual design, Fonts; sizes decided |
| Headings h4 to h1 | Instrument Sans 600, 16, 20, 25, 31px | brief: Type, "about a quarter larger"; sizes decided |

## Space and layout per viewport

| Surface | 1280x800 | 768x1024 | 375x812 | Source |
|---|---|---|---|---|
| Top bar | 56px carbon, signed-in only, in page flow; stuck to the viewport top only on `/ledger` | Same | Same | brief: Measured values; flow decided |
| Status strip | 32px, sticky at the viewport top (under the bar on `/ledger`), rule and fill only while it holds a message | Same | 44px, otherwise the same | decided: action messages never shift the page |
| Notice slot | 44px on `/ledger`, otherwise as tall as a notice | Same | 80px on `/ledger`, otherwise as tall as a notice | decided: the walk's rail must not move under the head; elsewhere an always-empty band reads as a layout fault |
| Docket routes | Nav 240, docket 480, inspector rest | Docket 308, inspector rest; nav in drawer | One pane per the brief's route table; nav in drawer | brief: Screens and layout |
| Pane padding | 16px | 16px | 16px | decided: fits the exhibit id |
| Figure on the exhibit | 110 to 113px in the inspector | 89 to 92px | 70.5 to 72px | decided: fit formula |
| Chain Walk | Rail 320 left, panel pinned right, 16 by 4 cells, 44px tall | Rail 240, 16 by 4, 30px tall | Panel pinned top, 8 by 8, 24px tall, anchors below, rail beneath | brief: Screens and layout, Motion; cell heights decided |
| Lattice | Canvas 832x560, side column 376, margins and gutter 24 | Canvas 720x480, then the rest, margins 24 | Verdict, canvas 343x343, camera and controls, margins 16 | brief: Screens and layout |
| Figure on the lattice | In the side column | In the block under the canvas | With the verdict, above the canvas | decided: keeps the published order |
| Timeline scroller | 320px tall, inspector width | Same | Same | brief: Screens and layout |
| Link collection | One column, 720px at most | One column | One column | brief: Screens and layout; width decided |
| Controls | 36px high (44px on coarse pointer) | 44px both ways | 44px both ways | brief: Visual design for 768 and 375; 36 decided |
| Grid | 12 columns | 12 columns | 12 columns | brief: Composition |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| Control tone | Hover, press | 100ms | linear | Instant | brief: Motion; easing decided |
| Drawer, dialog | Open, close | 250ms | `cubic-bezier(.16,1,.3,1)` | Instant | brief: Motion; curve decided |
| Upload fill | Bytes sent | None, set directly | None | Same | brief: Motion |
| Digest cells | Head reaches a link | 100ms each, 6ms apart, 478ms total | `cubic-bezier(.16,1,.3,1)` | Whole digest at once, `data-digest-state` straight to `settled` | brief: Motion; stagger decided |
| Link mark | Link verified or break | 300ms | `cubic-bezier(.16,1,.3,1)` | Instant | brief: Motion; value decided |
| Numeral | Verified-through rises | 300ms | `cubic-bezier(.16,1,.3,1)` | Direct | brief: Motion; value decided |
| Lattice idle | Arrival, until focus or input | 50s per turn | linear | Never runs, `data-idle` is `false` | brief: Motion, 40 to 60 seconds; value decided |
| Lattice reset | `Reset view` or `R` | 300ms | `cubic-bezier(.16,1,.3,1)` | Immediate | brief: Motion; value decided |
| Timeline fill, stops | Scroll | 250ms | `cubic-bezier(.16,1,.3,1)` | At once, `data-scrub-state` always `settled` | brief: Motion; value decided |

Nothing else moves: no spinner, no shimmer, no entrance and no view transition. Source: brief: Motion and effects, No other loops.

## States per async action

Pending, success and outage copy is exact in the brief's first Feedback states table, shown in the region it names. Source: brief: Feedback states.

| Action | Region | Control while pending | Refusal treatment |
|---|---|---|---|
| Register | `status "Intake status"` | Disabled, `aria-busy`, progress bar | Vermilion, icon; summary and field copy |
| Clear, Refuse | `status "Action status"` | Disabled, `aria-busy` | Vermilion, icon; focus fallback |
| Issue, edit, revoke grant; End sessions | `status "Action status"` | Disabled | Vermilion, icon; stale keeps the dialog |
| Place, lift hold; propose, confirm, cancel disposal | `status "Action status"` | Disabled | Vermilion, icon; `Under legal hold...` with hold icon |
| Save marks, Find, Render, Preview | `status "Redaction status"` | Disabled; preview shows paper canvas box | Vermilion, icon |
| Download, Open item | `status "Action status"` | Disabled | Vermilion, icon |
| Add, remove item; Submit; Sign off; Reject; Reopen; Share; link actions; Withdraw | `status "Action status"` | Disabled | Vermilion, icon |
| Break-glass | `status "Action status"` | Disabled | Vermilion, icon; reason copy below the field |
| Collect | `status "Collection status"` | Disabled | Vermilion, icon |
| Sign in again | `status "Sign-in again status"` | Disabled | Vermilion, icon; first copy in ink |
| Step-up | `status "Step-up status"` | Disabled, dialog stays | Vermilion, icon; focus to password or reason |
| Custody check | `status "Custody status"` | None | Ink; `Altered` on the row in vermilion |
| Lattice verdict | `status "Lattice verdict"` | None | Ink; nodes in vermilion |
| Walk, anchors | `status "Walk result"`, `status "Anchor status"` | None | Ink; cells, mark and rail text in vermilion |

Lists load with static skeleton rows. Empty lists use a small drawing and a sentence: `Choose a row to inspect it.` (brief: Feedback states), and `Nothing in quarantine.`, `Nothing waiting for a decision.`, `No exhibits match.`, `No compartments on your grants.` (decided: the brief is silent, and each states the fact). Inside a ruled section, a table with no rows hides its header and shows one plain sentence: `No exhibits yet.`, `No releases yet.`, `Nothing recorded.` (decided: same reason).

Each `data-figure-label` text is decided, since the brief fixes the figure and not its words: `Custody and disclosure` (`/sign-in`), `In quarantine` (`/intake`), `Total exhibits` (`/compartments`), `Exhibits` (`/compartments/<id>`), `Exhibit` (`/exhibits/<id>`), `Items` (`/releases/<id>`, `/l/<token>`), `Waiting` (`/reviews`), `Verified through` (`/ledger`), `Links` (`/audit/chain`), `Open signals` (`/ledger/review`), `Not found` (Not found).

## Breakpoints

| Width | Meaning | Source |
|---|---|---|
| 1200 and wider | Three panes, permanent nav | brief: Screens and layout |
| 768 to 1199 | Two panes, drawer | brief: Screens and layout |
| Below 768 | One pane, 8 by 8 cells | brief: Screens and layout, Motion |
| 1280 | Lattice goes side by side | decided: 832 + 376 + 72 is exactly 1280 |
| 480 | Top-bar wordmark hidden below it | decided: 44px controls take the room |

## Media and licences

| Item | Licence | Source |
|---|---|---|
| Martian Mono 400, 700, latin and latin-ext, `@fontsource/martian-mono@5.3.0` | OFL-1.1, `app/static/fonts/OFL-MartianMono.txt` | brief: Fonts; package decided |
| Instrument Sans 400, 600, latin and latin-ext, `@fontsource/instrument-sans@5.3.0` | OFL-1.1, `app/static/fonts/OFL-InstrumentSans.txt` | brief: Fonts; package decided |
| Icons and empty-state drawings, inline SVG drawn for this app in Lucide's style | original | decided: no icon package ships |
| Lattice, exhibit previews | Drawn at run time from data | brief: Chain lattice, Preview pages |
