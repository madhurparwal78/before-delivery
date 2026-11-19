# TRUTH — Pellory Works Rulehouse (Quenby & Co.)

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied from the brief) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys, end to end

### J1 An agency asks for the right variant (brief: Journeys 1)
1. Start: Ana Ferreira (Studio Lumen, `ana@studiolumen.example`) signed in; GR-0001 gives her the Tab variant of the Logo.
2. She reads the Logo chapter at `/chapters/logo` (rule `logo.variants.full-lock` and `logo.variants.tab` visible).
3. `/library`: `Logo — Tab` badge Available; `Logo — Full lock` Request required with disabled `Download` and the visible reason `Request use to download.`.
4. By keyboard she opens `dialog "Request Logo — Full lock"`; Application Co-brand, Campaign end after 15 Apr 2026; `status "Request notices"` reads `Your engagement ends on 15 Apr 2026, so any grant will end by then.`; she cites two rules and submits.
5. End: `/requests/REQ-0005` shows `Under review`, `Held by Bea Lindqvist`, `Due 5 Mar 2026 09:00`, links for both cited rules; Page status `REQ-0005 submitted.`; audit has `request.submitted` and `request.assigned`; a stage mail `Review needed: REQ-0005 Logo — Full lock` sits in Mailpit for Bea. (brief: Journeys 1, Routing, Mail)

### J2 Three reviewers decide and the grant arrives live (brief: Journeys 2)
Bea approves stage 1, Cai stage 2 (first/second brand review of a mark asset), Leo adds `Keep clear space of 1x the symbol height on every side.` and `Do not recolour the mark.`; his panel reads `Grant will end on 15 Apr 2026 (engagement end)`; he approves. Ana's open page announces `REQ-0005 is now Granted.` in `Request updates`, shows `Ends 15 Apr 2026` and both condition texts; mail `Granted: REQ-0005 until 15 Apr 2026` is in Mailpit. Audit: `request.decided` ×3, `condition.added` ×2, `grant.minted`.

### J3 Downloads end when the grant ends (brief: Journeys 3)
Ana presses `Download logo-tab.svg` → `POST /api/derivatives/drv_logo_3/link`, card shows `Link expires at <HH:mm>`. Leo revokes GR-0001 (`Revoke GR-0001` dialog, reason) → Page status `GR-0001 revoked.`, Ana's open library badge changes to Request required, her old link answers 404 `Not found`. Finn's link answers 410 `This link has expired.` once the clock passes 300 s. Audit `grant.revoked`, `link.issued`.

### J4 A proof unlocks a grant (brief: Journeys 4)
Finn (GR-0004 Pending proof) uploads a renamed text file → `Proof must be a PNG, JPEG or PDF file.`; an oversized PNG → `Proof must be 5 MB or smaller.`; a valid PNG → row `<file> — Pending review`, Page status `Proof uploaded. Waiting for review.`; object at `proofs/GR-0004/PRF-0001`. Bea accepts in her session (`Proof accepted.`) → GR-0004 Active, Finn's page updates live. Audit `proof.uploaded`, `proof.accepted`, `grant.activated`.

### J5 A chapter version waits for its assets (brief: Journeys 5)
Ari submits Iconography v2 (`Version 2 submitted for review.`), Bea approves, Olu's publish is refused `Cannot publish version 2: Courier spot icon is draft.`; release is refused `Cannot release: courier-128.png is 128 x 128; a Spot icon must be 120 x 120.`; Olu removes the file, adds a 120x120 PNG, releases (`Courier spot icon released.`) and publishes (`Version 2 published.`). Anonymous `/chapters/iconography` shows `Version 2, published <date>` at once. Republish v1 as v3 (`Version 3 published from version 1.`): v2 superseded.

### J6 A missed deadline lands with the owner and on the record (brief: Journeys 6)
A Co-brand request submitted at 2026-03-02T08:00Z: warning mail to the holder at 2026-03-04T14:00Z, breach at 2026-03-05T08:00Z (stage to Olu, `Escalated: deadline missed`, mail `Deadline missed: <id> is now yours`), expiry at 2026-03-08T08:00Z (state Expired, requester mail). Olu filters `/admin/audit` by request id, reads before/after cells, `Verify chain` → `Chain verified: <n> records.`; after tampering `Chain broken at record <k>.`.

### J7 A public reader learns the brand by playing (brief: Journeys 7)
Home scroll assembles the mosaic; weight slider, palette wheel + swatch filter, motion playhead and curve editor all show their published readouts by keyboard, pointer and touch.

### J8 A new agency partner is invited (brief: Journeys 8)
Olu invites at `/admin/people` (`Invitation queued for <email>.`); mail `Your Rulehouse invitation` carries `<APP_PUBLIC_URL>/activate/<token>` and `This link works once and expires on <D MMM YYYY> at <HH:mm>.`; the invitee sets a password ≥ 12 characters, lands signed in on `/library`; reopening the link shows `This invitation link is no longer valid.`.

## Palette roles (brief: Visual design; hex from the swatch table)
ground #FFFFFF · ink #17161C · muted Stone 700 #4D4A55 · accent Harbour 700 #1F4E8C · on-accent #FFFFFF · grid line Harbour 300 #9DBDF0 at 40% · fields Ember #F2A08C, Saffron #F7C266, Meadow #A9D99A, Lagoon #7FD3D0, Iris #C6B2F0, Orchid #EDA8DC, Clay #E0B9A0, Moss #CFD88E; Retired badge Stone 300 #C9C6CF (brief: Badges "Retired stone"). Tile fields: Logo Lagoon, Colour Saffron, Typography Ember, Iconography Meadow, Motion Iris, Voice Moss, Library Clay, Rule index Orchid; mark tile Harbour 700.

## Type (brief: Typefaces)
System UI sans stack only; display 650 for headings, tile labels, button labels; body 400/600; tabular figures everywhere; hero 36px desktop / 24px phone, promise 30/20, tile label 33.6/20 (desktop: 2.2vw capped at 33.6 so "Iconography" never breaks in the 1280 first column), "Aa" 140/80 (decided: the seed's measured sizes, re-expressed). No web font.

## Space, layout per viewport
- Cell padding 23px; mosaic margin and gutters 10px on desktop (5px/6px static phone mosaic); outer corners 8px, inner sharp (brief: Composition, Corners).
- Desktop ≥ 768: 4 mosaic columns `1fr 1.75fr 1.4fr 1fr`, rows `1fr 90px 1fr` (decided: unequal widths and a 90px mark tile per brief); library 3 columns at 1280, 2 at 768; queue table; decision panel as right cell.
- Phone < 768: stacked home (opening cell 325px, promise card 325px, 2-column mosaic), one-column library, queue cards, decision bottom sheet ≤ 66vh.
- No horizontal overflow at 375, 768, 1280 (brief: Breakpoint rule).

## Motion table (brief: Motion and effects)
| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| UI state changes, tile hover (corners, label shift) | state/hover | 350 ms | cubic-bezier(0.4,0,0.2,1) | instant |
| grid-line fades | mount | 1500 ms | ease-in-out | none (lines static) |
| block settling (unscrubbed) | layout change | 3000 ms | cubic-bezier(0.5,0,0,1) | none |
| rulebook assembly | scroll 0–2700 px | scrubbed (function of progress) | linear in progress | three static stacked sections, opacity 300 ms |
| weight specimen | slider | 500 ms font-weight | ease | 0 s |
| bottom sheet | Decide | 350 ms rise | ease-out | appears without sliding |
| Play / Replay | press | 1 s per s / 1000 ms | linear / printed curve | jump to end |

## States per async action (brief: Feedback states)
Pending words: `Signing in`, `Uploading`, `Checking chain`, `Saving` (button disabled until the response). Success copy in `status "Page status"` per the brief's table; errors verbatim in an `alert` inside the failing form/panel/card/row; empty states: `No assets match these filters.`, `Nothing is waiting for you.`, `You have no requests yet.`, `No audit records match.`; storage outage (MinIO down): health `{"status":"unavailable"}` (200), proof upload `Proof storage is unavailable. Your request is unchanged.`, link issue and `/dl` `Downloads are unavailable right now.`, release and derivative changes `Storage is unavailable. Nothing was changed.`; chapters, library, queue, requests keep working.

## Decisions where the brief is silent (decided)
- `GET /api/organisations` (owner only, other roles 403) feeds the Admin people screen: the screen lists organisations and engagement ends and no published route offers them.
- `GET /api/me` also returns `engagement` (agency partners): the request dialog needs the engagement territories and no published route offers them.
- Audit records also carry `actorName` (display name or `System`): the audit table prints it and no published route resolves actor ids.
- Denied start/save attempts on chapter versions are audited as `chapter.started` / `chapter.saved` (outcome `denied`); successful starts and saves write no record, as the action table lists none.
- Audit `occurredAt` of a timer record is the due instant it fired at (a clock jump fires timers in time order).
- Stage labels: `Brand review`, `First brand review`, `Second brand review`, `Legal review`.

## Media (brief: IF-05)
No binary assets. The Quenby mark (three stacked trapezoids with chevron cuts), eight tile glyphs, badge glyphs and empty-state glyphs are inline SVG written for this product (licence `original`); the seed files are generated PNG/SVG bytes drawn by the server at the stated sizes.

## Breakpoints
768 px: the one breakpoint (desktop layout at ≥ 768, phone layout below). Reduced motion has the same stacked home as phones.
