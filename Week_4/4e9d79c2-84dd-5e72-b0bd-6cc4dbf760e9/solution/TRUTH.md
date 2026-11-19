# TRUTH

The brief made concrete. Each value says where it came from: `brief: <section>` or `decided: <why>`.

## Journeys

1. **A request becomes a ticket.** Start: a visitor on `/occasions/school`. Action: `Get a free quote` opens `/quote?occasion=school`, which answers 303 to `/quote/route` with School chosen; the ticket counts 2 with no flight. Each answer flies 320 ms to its line. `Next` checks its own step; `Send request` shows `Working…`. End: `/quote/thanks` reads `Request sent. Your reference is <reference>.`; Postgres holds the enquiry with `submitted_body` byte for byte; it heads `/enquiries`. (brief: Journeys 1, Interactions)
2. **From enquiry to priced plan.** Start: a New enquiry. Actions: order stops, `Save plan`, `Ask operators`. Provider: one Mailpit message per operator, subject `Price request <reference>`. Operator opens `/b/<token>`, enters prices. Desk: `Award` on one `Clear` row. End: vehicles at the bid's prices, one run per vehicle, one `Hire <reference> has closed` per loser. (brief: Journeys 2, Business rules: Bids)
3. **From bought price to accepted quote.** Margin typed: totals change in place by `POST .../quote/preview`, one announcement. `Send quote` saves edits and sends one mail. Customer at `/q/<token>` types their name; `I've sent the deposit` sets `depositSaidSent`; the ledger is untouched. (brief: Journeys 3)
4. **The statement tells the truth.** `Bring in statement` sheet, `Read file` previews with nothing stored, `Bring in` writes paired ledger lines; `Money held` equals the sum of `clientMoney`. The same file twice changes nothing. (brief: Journeys 4, Allocation, Ledger)
5. **A legal, known run.** A move across a change keeps wall time. A break moved on the ribbon clears a breach; `Confirm run`; `Assign driver` shows `Driver told at <time>` only after ntfy accepts. (brief: Journeys 5)
6. **On the road with no signal.** Presses show at once and wait in `localStorage`; a service worker serves the page offline; back in signal they go in order with their repeat keys. `Accept charges` lands them once. (brief: Journeys 6, decided: `localStorage` is the phone's own store, no server store is added)
7. **Things change.** `Change booking` shows `Old` and `New`; a moved price replaces the private page and mails it; cancellation charges follow UK calendar days. (brief: Journeys 7)
8. **Paper and aftercare.** `Make document` strip reaches `Stored` after MinIO confirms; complaint reply dates count working days; a closed customer returns for 7 days and is then erased. (brief: Journeys 8)

## Palette

| Role | Hex | Source |
|---|---|---|
| Ground | `#FFFFFF` | brief: Visual design, seed inventory |
| Plum, dark surface and brand ink | `#33044A` | brief: Visual design, seed inventory |
| Cyan accent | `#2FBAD1` | brief: Visual design, seed inventory |
| Reading ink | `#000000` | brief: Visual design |
| Client marks grey | `#767676` | decided: the mid-grey the brief asks for, at AA on white |

## Type

Poppins display and body; Noto Sans labels, buttons and figures with tabular figures; Noto Nastaliq Urdu at line height 2. (brief: Visual design: Type)

| Use | 375 | 1280 | Source |
|---|---|---|---|
| Hero title | 30 px | 45 px | brief: nearly three times body on desktop, just under twice on a phone |
| Section headings | 34 px | 34 px | brief: a little over twice body |
| Other level-one headings | 36 px | 36 px | decided: a step above the section headings |
| Urdu customer page heading | 28 px | 28 px | decided: heading and reference on one phone line at Nastaliq's double line height |
| Hero second line | 18 px | 32 px | decided: one phone line, clear of the coach's roof |
| Body | 16 px | 16 px | decided: comfortable density |

## Space and layout

| Viewport | Layout | Source |
|---|---|---|
| Below 768 | Phone layout; main action in a fixed bottom bar; desk `Menu` sheet; diary agenda | brief: Screens and layout |
| 768 up | Wider layout; desk navigation in the band; week grid | brief: Screens and layout |
| Below 1024 | Phone top bar 70 px; ticket as bottom bar and sheet; one column of cards | brief: Screens and layout |
| 1024 up | Masthead, main navigation, ticket beside the form, cards in four columns, rail beside sections | brief: Screens and layout |
| Text inset | `5vw` | brief: about one twentieth of the screen |
| Inset beside fixed links | 96 px from 1024 on the form, Fleet and Terms | decided: `Message us` is 60 px at 20 px from the edge, so text clears it |
| Shapes | No radius except `Message us` | brief: Visual design |

## Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| `ticket-flight` | answer completes or changes a line | 320 ms | `cubic-bezier(.05,.7,.1,1)` | value appears on its line at once, no element | brief: Motion |
| Step | `Next`, `Back` | 320 ms | same | changes at once | brief: Motion |
| `slim-bar` | scroll past 200 px | 160 ms | same | at once | brief: Motion |
| Search overlay, public Menu, sheets, dialogs | open, close | 320 ms | same | at once | brief: Motion, SR24 |
| Accordion | press | 320 ms | same | at once | brief: Motion |
| Section rise | first time in view | 640 ms | same | none | brief: Motion |
| Client marks | `Earlier`, `Later` | 320 ms | same | at once | brief: Motion |
| Occasion card | hover and focus | 160 ms | same | none | brief: Motion |
| `Message us` ring | load, three plays | 640 ms each | same | never plays | brief: Motion |
| Stop rows | reorder | 160 ms | same | at once | brief: Motion |
| Diary card | Escape or refused move | 160 ms | same | at once | brief: Motion |
| Ribbon blocks | break moved | 320 ms | same | at once | brief: Motion |
| Two seats | swap | 320 ms | same | at once | brief: Motion |
| Document check | step finished between two reads | 320 ms | same | at once | brief: Motion |
| `page-wipe` | moving between desk screens | 320 ms | same, on the way in and on the way out | no wipe, focus at once | brief: Motion, SR31 |

The easing is decided: the seed's fast start and long soft settle, at the three published durations.

## States per async action

Every action follows one path (brief: Feedback states): pending `Working…` on the pressed button with `aria-disabled` and focus kept; success announces its copy and shows it on the status line; refusal fills `group "Problems"` with one link per field, sets `aria-invalid` and the description, and focuses the summary, staying open as typed in a dialog. Exceptions the brief names: the `State` bar shows `Saving…`, run sheet presses show at once. A failed refresh shows `Couldn't refresh. Trying again.` in `data-part="refresh-line"` until the next good read. An ended session shows its line and `Sign in again`, keeping the dialog and what was typed in `sessionStorage` for after sign-in (decided: a browser-side draft adds no server store).

## Breakpoints

768 and 1024, exactly. (brief: Screens and layout)

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Poppins, Noto Sans, Noto Nastaliq Urdu woff2 | OFL-1.1 | Fontsource packages, `app/assets.json` |
| All drawings, icons, marks, favicon | original | generated SVG in `app/src/server/pages/art.ts` |
