# TRUTH

The brief made concrete. `brief:` values are copied from `instruction.md`; `decided:` values fill a silence and say why.

## Journeys

1. **Taking a piece in** (brief: Journeys 1). Noor signs in → `/staff/pieces`. New piece → fill → Save piece → `/staff/pieces/<id>`, focus on the tag-code heading, `Piece <tag code> saved.`. Add photo twice: `Photo saved.`. MinIO holds `pieces/<id>/photos/<photo id>/original` and `/public`; Postgres the photo rows.
2. **Browsing and holding** (brief: Journeys 2). `/` at 375 → Filters sheet → M, band, "wool": list in place, address carries each. Piece page → Hold this piece → name, email → `Held for you until <time>…`, focus back on the opener. Mailpit gets one mail with `/h/<token>`. A loser sees `Someone else is holding this piece until <time>.` with the dialog open.
3. **Selling at the till** (brief: Journeys 3). `/staff/till` → tag code, Enter → Sell → arrows → Complete sale → `/staff/sales/<id>`, focus on heading, `Sold <tag code> for <price>.`; one `sales` row with share, commission and VAT. A loser sees `Sold by <name> at <time>. Nothing was charged.` with the dialog open.
4. **The markdown ladder** (brief: Journeys 4). `/staff/ladder` → Change ladder → Save ladder → `Ladder saved. It applies to pieces taken in from <date>.`; one `ladders` row; earlier pieces keep their ladder.
5. **Month end** (brief: Journeys 5). `/staff/payouts` → Start payout run → month → Start run → `/staff/payouts/<YYYY-MM>`; payouts in Postgres, `payouts/PAYOUT-<YYYY-MM>.xml` in MinIO, one statement per consignor in Mailpit, all or none.
6. **The consignor's page** (brief: Journeys 6). `/c/<token>` → Return to me or Donate → Save choices → `Choices saved.`, focus stays. `/appointments` → slot → Book slot → Confirm booking → `Booked for <date-time>…`, focus on `Week of <date>`; one mail with `/appointments/cancel/<token>`.
7. **Moving over and closing books** (brief: Journeys 7). `/staff/import` → Choose file → Preview import → Save → `Saved: <n> pieces and <n> new consignors brought over.`. `/staff/sales-book` → Download sales book → Download → `Sales book for <Month YYYY> downloaded.`.
8. **Period end and erasure** (brief: Journeys 8). Status is derived from dates at read time. Erase → name replaced at once, photos deleted, `erased` only after MinIO confirms; Archive and Bring back keep everything.

## Palette, type, space, layout

See `DESIGN.md`: ground `#F6F1E7`, paper `#FBF8F1`, ink `#1F1C18`, muted `#5E574D`, rule `#CFC6B5`, tag `#ECDFC6`, accent `#A33A22` (brief: Visual design; hex decided: unbleached cotton, near-black, card stock, brick, all AA). Garment fills: cloth `#E2D6C2`, `#D2C5AF`, `#BFB29C` (decided: the tag's beige family, so the ink stays the only dark and the accent the only hue). Markdown percentages are accent in every station state; the current station is marked by a larger filled ink dot, a heavier label and `Now` (brief: the accent marks markdown percentages, not position). Familjen Grotesk display, Hanken Grotesk body (brief: Type). 40px section gaps (brief: Density).

Viewports (brief: Screens): ≥1100 filters column (sticky, decided: stays usable beside a long rail) + 3 columns, staff table + 280px detail (width decided: narrow column); 768–1099 two columns + side sheet, detail below; <768 one column, bottom sheet, Menu, fixed bottom bar.

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Buttons, pills, slots, links | hover or press | 160ms (brief) | cubic-bezier(.34,1.3,.64,1) (brief: overshoot; curve decided) | none |
| Dialogs, sheets, Categories, popover | open, close | 320ms (brief) | cubic-bezier(.34,1.3,.64,1) both ways (brief: overshoot; leave the same way they arrive) | at once |
| Price slide, strike draw | price changed while open | 320ms (brief) | cubic-bezier(.34,1.3,.64,1) (brief: overshoot) | price and strike in the same frame |
| Tag swing | price changed while open | 640ms (brief) | keyframes +6°, −4°, +2°, 0° about the hole, ease-in-out between them (brief: at most 6°, overshoots level and settles) | none |

## States per async action

Pending: pressed button disabled and `Working…` (brief). Results: the Feedback states copy in `status "Announcements"`, and refusals also in `region "Problems"` (brief).

Decided where the brief is silent:
- A price change seen in a refresh is not announced, because SR1 forbids a refresh replacing the last announcement. `Price changed to <price>.` is announced for the owner's own save.
- Sign-in refusal: `That email and password don't match a member.`
- Send page address with Mailpit down: `The page address can't be sent by mail right now. The old address still works.`
- Role change: `Role changed.`, remove: `Member removed.`; the members screen needs them and the brief's journeys require those actions.
- A consignor without an email asked for a page address answers 422 `fields.email`.
- The hold page's `piece` carries `category` as well, so its drawing shows the right garment.
- The announcement is a sticky band at the top of the page, above open dialogs, taking taps only on its Sign in again link.
- Months offered for a run and in the sales book come from the server's `Date` header, 36 months back, so the device clock plays no part.
- `period_ends` station price is the second markdown's price: no later markdown exists.
- An edit that leaves the price the same does not count as a price change for `previousPriceCents`.

## Breakpoints

1100 and 768 pixels (brief: Screens).

## Media and licences

Generated SVG garments and tags: original. Icons: Lucide, ISC. Fonts: SIL OFL 1.1, self-hosted (`app/public/fonts`, `app/assets.json`). The shop's uploaded photos are served from MinIO through the app.

## Payout ordering when mail fails

Brief: all of it happens or none of it does; when MinIO or Mailpit cannot complete its part, nothing is recorded, stored or sent, and the start answers 503. Decided how: each statement waits on its own SMTP session, complete but for its final dot. The bank file is stored once all of them are waiting, and the statements go out only after that, in the same database transaction as the run. A failure before then closes the sessions unsent, deletes the file and rolls the transaction back.
