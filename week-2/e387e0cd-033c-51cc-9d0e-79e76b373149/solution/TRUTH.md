# TRUTH — Lanternline Handshake Desk

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **On-network withdrawal** (brief: Journeys 1). Analyst on `/w/neris/cases` → Create case (ETH 0.3, Harbourgate
   address, cust-neris-01) → URL `/w/neris/cases/<id>`, `Case NRS-00000n created.` in Desk status. Track: Screened,
   Counterparty found, Data sent done; Answered `current: Waiting for answer` with an amber ring and amber token;
   `timer "Answer countdown"` reads `Answer due in H:MM:SS` from `answerRemainingSeconds`. One metered `sent` message is
   recorded. Harbourgate posts a signed `answer` → next poll (1 s) the token glides (640 ms), the Answered ring fills
   (320 ms), its stamp fades in (160 ms). Ops presses Release → `Released. The withdrawal can leave.`; Closed `done:
   Released` with a Vilnius stamp; erasure `scheduled` for closedAt + RETENTION_SECONDS. After retention the job nulls
   originator and beneficiary and deletes the case's stored objects; Evidence reads `Personal data erased on <dt>.`;
   officer archives (`Case archived.`, `Archived on <dt>.`) and brings it back (`Case brought back.`), identical body.
2. **Off-network withdrawal** (brief: Journeys 2). Case to Tallinn Star → request page issued, mail to
   `compliance@tallinnstar.example`, subject `Travel Rule data request <ref> from Neris Digital`, body with `/r/<token>`,
   reference, `ETH 0.3`, masked addresses, `This page ends at <dt>.` Contact answers Accepted + certificate →
   `Answer sent. Thank you.`; certificate stored GPS-free at `neris/certificates/<id>`; Answered `done: Accepted`.
   Without an answer the case reads No response at the due instant; officer records a reason; ops may release.
3. **Review** (brief: Journeys 3). Baltic Rail case `in_review`; two claims → one 200, the other `409 already_claimed`
   `Claimed by <name> at <dt>.`; winner decides Accept with a reason → data sent at the decision instant; a late
   decision → `Already decided by <name> at <dt>.`, typed reason kept.
4. **Import and rename** (brief: Journeys 4). Preview marks matched/new/refused with row numbers; save twice → second
   `Import saved: 0 created, 0 updated, n unchanged.`; rename shows everywhere, sent records keep the old name,
   `list "Previous names"` lists it with business dates.
5. **Threshold change and file** (brief: Journeys 5). A change for today takes effect at the announcement instant;
   earlier cases keep `decidedUnder`; the regulator's CSV carries the rule each case was decided under.
6. **Incoming deposit** (brief: Journeys 6). Signed transfer stored byte for byte at `neris/messages/<id>`; name check
   Match / Partial / No match; Download original returns exactly the received bytes as `<messageId>.json`.
7. **Month close** (brief: Journeys 7). Ready month → Close month → Kill Bill account `lanternline-neris`, one invoice
   with one EXTERNAL_CHARGE per tier (`<tier label>, <count> messages, <Month YYYY>`), then fee lines + invoice id
   recorded in one transaction, then one mail `Lanternline: <Month YYYY> closed` to every finance lead.
8. **Public visitor** (brief: Journeys 8). Filters and search in the address (`?region=&status=&q=`), Back/Forward
   restore, latest request wins; bottom Filters sheet below 1120 px.

## Palette (brief: Visual design; decided hex values)

ground `#0a1120`, raised `#101a2d`, sheet `#15213a`, hairline `#26354f`, ink `#e8eef8`, muted `#9daac2`,
amber `#f0b23a` (waiting ring, token and row marker only, never text), coral `#ff8b7b` (refusals, late, errors),
link/focus `#a8c6ff` (links and focus only; a current non-waiting ring is a muted track with an ink core), primary fill
`#2a4a7f`. No shadows; layers step by ground and hairline; the sign-in page is plain ground (decided: texture only in the
network band). Money crosses the browser boundary as BigInt: `…Cents` integers are read from their JSON source text
(decided: Engineering standards, no binary floating point).

## Type, space, layout

Space Grotesk 600 headings (h1 29.3 px, h2 23.44, h3 18.75: each a quarter larger, brief: Visual design); IBM Plex Sans
15 px body; IBM Plex Mono tabular for every amount, LEI, address, countdown and instant. 4 px spacing unit, 6 px
control radius, 10 px panels (decided: exact, instrument-like). Every control ≥ 44 × 44 px. One breakpoint 1120 px
(brief): rail + work + evidence from 1120; top bar + `Sections` sheet, stacked cards, vertical track and a sticky
action bar below.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| control hover/press, chevron, stamp fade, tooltip | hover, press, server step | 160 ms | cubic-bezier(0.16,1,0.3,1) | instant |
| ring fill (stroke-dashoffset), stats roll, sheets/menus/dialogs | server step, first view, open/close | 320 ms | same | instant |
| track token glide, network packet pass (infinite loop), card rise | server step, loop, first entry | 640 ms | same | token placed, packets rest at connector ends |

The signature step (token glide, ring fill, stamp fade) is started with `element.animate()` in the same task that
commits the new server record, so all three begin at one moment (decided: the brief's "start at the same moment").

## States per async action

As published in brief: Feedback states (pending, success, refusal copy), shown next to the control and in the named
live region; never replaced by a poll. Session over → copy + `Sign in again` with the typed fields restored after
sign-in; access removed → copy + `Sign in`.

## Media and licences

Network band, icons and empty-state glyph drawn in code (original). Fonts: Space Grotesk, IBM Plex Sans,
IBM Plex Mono (OFL-1.1, Fontsource 5.3.0, self-hosted). Shipped packages: pg tree (MIT/ISC) and preact (MIT).
