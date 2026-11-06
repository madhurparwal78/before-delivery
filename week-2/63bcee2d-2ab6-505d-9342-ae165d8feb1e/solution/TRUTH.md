# TRUTH: Marrow Hall Interiors Plumbline

Every value is marked `brief:` (copied from instruction.md, section named) or `decided:` (the brief leaves it open; the
reason ties it to the brief's intent). Where this file and the brief ever differ, the brief wins.

## 1. Journeys

brief: Journeys, copied verbatim. Each journey's copy, focus targets and provider records follow Feedback states,
Interactions and Services exactly.

1. **Scheme sign-off.** Start: project Kestrel Tea House HK rollout (MH-2601) with Groundwork requested. The project lead requests nothing new. Dana Cheung and Quinn Yeo, both Kestrel approvers, open the Stages panel and press "Sign off Groundwork" at the same moment. End: one of them sees the success copy with the invoice number, and the other sees who signed and when. Kill Bill holds one invoice for HKD 60,000.00, and Mailpit holds one receipt, addressed to the winner.
2. **Sealed tender to award.** Start: a project in Tender & Award with no tender. Using only the keyboard, the project lead creates a tender with three bidders, publishes it and later moves the close. Each bidder receives an invitation and then an updated calendar file. Contractors follow their sign-in links, bid and amend. A late amendment gets the late copy. After close the lead opens the bids, prices every exclusion, sorts and filters the levelling table, exports it and awards. End: the tender shows "Awarded", and the project has a contract.
3. **Site walk.** Start: a designer on a 375x812 phone opens the Site walk panel for viewpoint VP-01. They swipe the seam across the render and photo and press "Drop snag here" in the sticky action bar, then pin a snag through the bottom sheet. Later the contractor marks it fixed and the designer closes it. End: after reload, the numbered marker sits at the same place and shows Closed in text and shape.
4. **Variation on site.** Start: Northvane Optics Singapore (MH-2603), where Tideway Joinery holds the contract. Kai Ng raises a variation on a phone and the request is retried on a flaky network. Jordan Lim and Casey Wong both edit it, and the stale save is refused with the newer saver's name. Jordan's approval is refused because the variation is over Jordan's limit, and the studio director approves it. End: one variation, approved, with its history.
5. **Monthly certificate and retention.** Start: MH-2603 with a contract and no certificates. The project lead issues certificates by keyboard and then records practical completion with today's date. They try to release final retention straight away, and the defects-period copy names the defects end date. Studio finance reviews each per-store split and the retention ledger. End: certificates whose store parts sum to the cent, a half release, retention still held for the final release, and a ledger whose pairs balance.
6. **Drawings, finishes and shop drawings.** Start: MH-2601 register. A designer uploads five sheet files at once, and one of them is refused and rolled back with its reason. They issue a set and download its transmittal ZIP, import the previous tool's finishes CSV, reorder a finish by keyboard and export the schedule. A contractor submits a shop drawing from a phone, and the designer returns it with a review code before its due date. End: the register shows new revisions, the transmittal is listed, and the shop drawing shows its code.
7. **Case study to public and back.** Start: the draft case study "Kestrel Tea House, Macao". The director sends a preview, and Dana approves it from the emailed link. The director publishes it, and a prospective client filters the public work index to Food & beverage, switches to list view and opens it from the featured rail. The director then withdraws it. End: it has gone from the grid, the rail, the counts, its URL and the preview link.
8. **Project enquiry.** Start: the public home page. A prospective client presses "Start a project" and completes the three-step enquiry by keyboard, reloading partway through without losing anything. End: the success copy with an enquiry reference, a notification to the studio director and an acknowledgement to the client in Mailpit.

## 2. Palette

brief: Visual design, Colour. decided: the hex values below realise the five colour roles.

| Role | Hex | Used for |
|---|---|---|
| warm unbleached plaster | #EFEBE2 | office ground and public plaster sections |
| near-black ink | #191A17 | text and the 1 px grid rules |
| deep green-black | #1F211E | public dark sections |
| oxide red | #B6462A | primary actions, focus outlines, the "Review overdue" flag and the Code 4 badge |
| muted sage | #5F6B55 | secondary states such as Code 1 and Fixed |

decided: contrast checked against WCAG 2.2 AA: ink on plaster 14.7:1, oxide on plaster 4.53:1, sage on plaster
4.74:1, plaster on green-black 13.6:1 and plaster text on an oxide fill 4.53:1. As a focus outline or another non-text
indicator, the one oxide reaches 4.53:1 on plaster and 3.01:1 on green-black, so it meets the 3:1 rule on both grounds.
Oxide (3.01:1) and sage (2.87:1) are too weak as text on green-black, so on dark sections primary links use an oxide
fill with plaster text, and sage is not used there.

## 3. Type

brief: Visual design, Type. Display face Instrument Serif for page and panel headings and big figures. Body face
Hanken Grotesk for everything else, including small capitals in title blocks. Each heading level is one third
larger than the level below. The largest public heading is about three times the body size.
decided: body 16 px and heading levels of 21.3, 28.4, 37.9 and 50.6 px, each one third larger than the one
below, so the home heading is about 3.2 times the body. Both faces are self-hosted (brief: IF-07) under OFL-1.1
(brief: IF-03).

## 4. Layout per viewport

brief: Screens and layout, copied verbatim.

- **1280x800 (mouse):** a 12-column drafted grid. The project tabs run across the top of the content, and panels sit on the grid with hairline ink rules between them. Dialogs are centred. On the Site walk panel the seam frame takes eight columns and the snag rail four.
- **768x1024 (touch):** the same grid at 8 columns. Tables keep every column and scroll sideways inside their own bordered region. Dialogs are centred, and the Site walk rail drops below the frame.
- **375x812 (touch):** one column. The tab strip scrolls sideways inside itself. Every dialog becomes a bottom sheet. The Stages, Variations, Shop drawings and Site walk screens get a sticky action bar along the bottom carrying that screen's primary action, named exactly like the screen's own button for it: "Request sign-off for <stage>" or "Sign off <stage>" for the project's current stage, "Raise variation", "Submit shop drawing" and "Drop snag here". The levelling table keeps its Bidder column pinned at the left while the other columns scroll sideways inside the table region.
- **All viewports:** the document never scrolls horizontally, and no fixed or sticky element covers the focused control or the control being tapped.

## 5. Motion

brief: Motion and effects, copied verbatim. decided: the one easing is cubic-bezier(0.62, 0, 0.08, 1), a slow
start, a quick sweep and a long gentle settle with no overshoot.

| Motion | Meaning | Feel and timing | Reduced-motion substitute |
|---|---|---|---|
| Panel wipe | Page change on the public site | A full-height panel sweeps across in 0.64 seconds, left to right forward and right to left back | The new page shows at once. Focus and title change exactly the same |
| Line reveal | A heading arriving | Each line rises a short way out of a mask over 0.64 seconds, the next line starting 0.16 seconds later | The heading shows in place at once |
| Rolling label | Hover or focus on a primary button | The label rolls up in 0.42 seconds and back on leave | The label stays still and its underline thickens at once |
| Header tone flip | Header over a dark or light section | Colours cross over 0.16 seconds | Colours swap at once |
| Rail inertia | Rail released after a drag | Glides with decaying speed and settles on a card within 0.64 seconds of release | The rail jumps to the nearest card at once |
| Seam glide | Snag card selected | The seam glides to the snag in 0.42 seconds | The seam jumps at once |
| Marker drop | Snag pinned | The marker grows from 0.6 of its size to full size over 0.16 seconds | The marker appears at full size at once |
| Bottom sheet and dialog | Opening or closing a sheet or dialog | Sheets slide up from the bottom in 0.42 seconds, and centred dialogs fade and rise slightly in 0.16 seconds | They appear and disappear at once |
| Row rollback and reorder | Refused optimistic row, or rows making way | Rows fade or slide over 0.16 seconds | Rows change at once |
| Press feedback | Pressing any button | The button darkens over 0.16 seconds | The colour changes at once |

brief: Motion and effects and Interactions. A transition or animation shorter than 1 ms counts as no motion. Without
reduced motion, a release faster than 0.5 px per millisecond carries the featured rail at least one card beyond the
card nearest to where it was released, in the direction of the drag, when there is such a card.

## 6. States per async action

brief: Feedback states. Every pending, success, refusal, rare-state and field-error copy comes verbatim from its
tables, with placeholders filled from the record and nothing else changed.

## 7. Breakpoints

brief: 375x812 (touch), 768x1024 (touch) and 1280x800 (mouse).
decided: the one-column phone layout applies below 768 px wide, the 8-column grid from 768 px and the 12-column grid
from 1280 px.

## 8. Media and licences

brief: Imagery and icons, IF-03 and IF-07.
decided: case-study covers are procedural SVGs drawn by the app at /media/covers/<slug>.svg (brief: API). The seed
render and site photo for VP-01 are procedural 1600 by 1000 images made at seed time (brief: Seed data). Icons
come from Lucide (ISC). The fonts are Instrument Serif and Hanken Grotesk (OFL-1.1).

## 9. Other decisions

- decided: the seam starts at s = 50 when the Site walk panel opens, an even split, because the brief sets no start value.
- decided: snag cards are listed by snag number, which matches the numbered markers.
- decided: each start-up holds one Postgres advisory lock while it applies the schema and the seed, so copies that start
  together apply them once (brief: Deployment).
- decided: the outbox sender claims each pending message with `SELECT ... FOR UPDATE SKIP LOCKED`, sends it and marks it
  sent in that transaction, so only the copy that claimed a message sends it (brief: Services, Mail).
- decided: tender, invitation and preview tokens are 32 random bytes in base64url: 43 letters, digits, `-` and `_`
  (brief: Business rules, Links and tokens).
- decided: text is stored as entered; only the finishes import trims and normalises codes and names (brief: Business
  rules, CSV exports).
- decided: list responses carry an `actions` array per record (stages, variations, certificates, tenders, snags, case
  studies) computed by the same domain rule that refuses the action, so the browser renders controls from server state
  and never re-decides a transition (brief: Engineering standards, each domain rule decided in one place).
- decided: the enquiry form's Next checks its step through `POST /api/enquiries` with `"validateOnly": <step>`, which
  validates only that step's fields and stores nothing, so the browser shows the API's own field copy (brief: Feedback
  states, "the text the API returns for that field").
- decided: `<time>` in the sign-off receipt and the lost-race copy uses Hong Kong time (HKT); SGT appears only where the
  brief says "project time" for a Singapore project (tender close, bid times, levelling export).
- decided: the browser keeps one idempotency key per opening of the Raise variation sheet and reuses it for retries
  after a network failure, so a retried raise replays the original (brief: Journeys 4, Idempotency).
- decided: a reorder cancel puts the row back at once with no slide, because cancel restores the schedule as it was
  rather than making rows give way (brief: Finishes reorder, "Escape cancels and puts the row back where it started");
  a new drag or move first ends any slide still running, so each row is pressed where it is placed.
- decided: an SMTP message counts as delivered once the server accepts its data; a later failure never resends it
  (brief: Services, Mail, "delivered exactly once").
