# TRUTH — Holdfast Register

The brief made concrete. `brief:` values are copied; `decided:` values say why.

## Journeys, start to end

1. **Checking vesting.** Start: Juniper Vance signed out on `/`. Sign in with `juniper@tidecraft.example` / `Tidecraft-demo-2026`; focus moves to the name heading "Juniper"; the board shows "Vested today: 21,000 of 48,000" and "Next tranche 30 Nov 2026" on server date 3 Nov 2026 (brief: Seed data, Business rules). Vesting opens TC-OPT-0007: 37 cells (cliff cell labelled with mark 12's date, then marks 13–48), vested cells red. The slider starts at the server's today; Right/Up +1, Left/Down −1, Page Up/Down ±12, Home returns to today, End goes to 48; Vested, Cost to exercise and Vested ownership come from the server's schedule. End: red cells for the server-vested months, figures for today. (brief: Journeys 1)
2. **Issuing a grant.** Mara opens Grants, "New grant" creates a draft and focuses Holder; she picks the holder, types options, strike, the vesting radio and the start; each change saves within half a second ("Draft saved"); "Submit to board" announces "Grant <id> sent to the board for approval." Priya and Theo approve from the board queue; Mara presses "Send offer <id>"; the holder's portal announces "A grant offer is waiting: <id>, <options> options." within a second. End: state Offered with `offer_expires_at` = offered_at + the offer window. (brief: Journeys 2)
3. **Accepting an offer.** Kenji opens TC-OPT-0011, reads "Grant agreement", presses "Accept grant": "Sealing your signed agreement in the vault.", the server writes `grant-agreements/TC-OPT-0011.txt` once, reads it back, compares SHA-256, then the grant is Accepted, the agreement is under Documents, focus moves to "Exercise". Vault down: the grant stays Offered, the signature Pending, red band and "Retry signing". (brief: Journeys 3)
4. **Exercising.** Juniper opens "Exercise", types 3,217, sees "Cost $1,346.31" (3,217 × $0.4185 rounded half-up once), confirms. The server inserts the order under its idempotency key, sends one payment to Quillon Pay under that key, fetches the record every 2 s, and issues shares only when the record reads confirmed with the order's amount and reference. The order page shows Reference, Amount and Confirmed, then the sealed notice. (brief: Journeys 4)
5. **Leaving.** Mara records a departure: the person becomes a leaver, unvested options are forfeited, the window ends at the recorded moment plus the leaver window. Rafael's ribbon has a black band ending in a countdown; an exercise received before the end counts; at the end unexercised options not in open orders are cancelled, cells turn muted and Exercisable now drops to 0. (brief: Journeys 5)
6. **Tendering.** Mara opens a tender (title, price, cap, "Closes at" in Pacific time). Larkspur signs the NDA (sealed at `tender-ndas/<tender>/<person>.txt`), types shares, submits; the projected allocation, remaining cap and countdown update in place from the one socket. At the close the allocation is pro rata in whole shares with leftovers one each in submission order; ledger entries move shares to Harbourline. (brief: Journeys 6)
7. **Modelling a round.** Mara types pre-money, investment and target pool; the result and the address update in place within half a second, with no submit button. (brief: Journeys 7)
8. **Changing access.** Mara changes Priya's role: Priya's open screen switches to the option-holder portal within a second, focus on the name heading, "Your role is now Option holder." Mara removes Kenji's access: the open viewer closes and the page shows "Your access to the Tidecraft register has ended." (brief: Journeys 8)

## Palette (hex the build uses)

ground #FFFFFF; surface #EDEDED; ink #0D0D0D; muted #6B6B6B; accent / focus / danger #D5001C; text on red #FFFFFF. (decided: values inside the brief's roles, each pair meets AA; see DESIGN.md)

## Type, space and layout per viewport

- Type: Funnel Display for headings and large numerals, Funnel Sans for the rest, tabular digits; scale 17 / 22.7 / 30 / 40 / 54 / 71 / 85 px (brief: Type, a third larger per step; figures 4–5× body).
- 1280 × 800: axis at 42vw = 537.6px; left zone holds name, id and side notes; board two by two; ribbon from the axis to the right edge, scrolling inside its track. (brief: Layout)
- 768 × 1024: axis at 42%; side notes sit above their heading; board two by two. (brief: Layout)
- 375 × 812: axis = 16px margin; board one column of four tiles; dialogs full screen; ribbon track and cap-table region scroll inside themselves. (brief: Layout)

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| sign-in title lines | first paint of the page session | 450ms per line, second delayed 70ms | cubic-bezier(.2,.7,.2,1) | no animation |
| ribbon cell fill / un-fill | marker passes the cell | 200ms | cubic-bezier(.2,.7,.2,1) | none, instant |
| tranche vests live | server midnight event | 200ms red fill | same | none |
| leaver cells cancel | window end event | 200ms muted fill | same | none |
| projection figures, portal figures | marker moves, live change | 300ms count ending on the server value | cubic-out | final value at once |
| tender allocation | tender allocated | 300ms count up from 0 | cubic-out | final figure only |
| buttons | press | 80ms background | linear | none |
| ribbon track | marker keyboard move | smooth scroll | browser | instant |

No loops anywhere. (brief: Motion)

## States per async action (copy verbatim from the brief's Feedback states)

Sign in: button text "Signing in"; refusal "That email and password don't match a Tidecraft register account." / "Your access to the Tidecraft register has ended.". Grant save: "Draft saved"; outdated: region "Draft changed" with focus on "Keep editing". Accept: "Sealing your signed agreement in the vault." then success or, after a refused attempt on this page, the red vault band; "Retry signing" shows whenever the signature is pending (a page opened on a pending signature says so in a plain line until an attempt is made). Exercise: "Sending to the provider"; pending "Payment pending at the provider. Your shares appear once it confirms."; provider down red band with "Retry payment". Notice: red band with "Retry notice". Tender: "Submitting", "Tender submitted: <n> shares at $<price>.". Documents: "Opening the document." and the red vault band. Page loading: black band "Loading your register." Empty: black bands with the brief's sentences. Unexpected server error: "Something went wrong on our side. Your register has not changed." Socket down: black strip "Reconnecting to the register." and the listed buttons disabled.

## Breakpoints

375 (phone), 768 (tablet), 1280 (desktop); layout changes at 767px and 1099px. (brief: Layout)

## Media and licences

Four greyscale photographs, CC0 (Openverse): `robot-arm-lab.jpg` (US Department of Energy, Oak Ridge National Laboratory), `robot-arm-library.jpg` (rawpixel public-domain), `workbench.jpg` (Lisa Fotios, StockSnap), `hands-at-desk.jpg` (Thomas Lefebvre, StockSnap). Funnel Display and Funnel Sans, SIL OFL 1.1 (Fontsource files). Lucide icon set, ISC. (brief: Assets; see THIRD_PARTY_NOTICES.md and assets.json)
