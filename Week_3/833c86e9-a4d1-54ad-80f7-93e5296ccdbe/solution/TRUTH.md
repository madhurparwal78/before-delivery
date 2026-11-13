# TRUTH — Kipwell Stays golden

The brief made concrete. Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>`.

## 1. Journeys (start state → actions → visible and provider-recorded end state)

1. **Search by keyboard** (brief: Journeys 1). Start: `/` in a fresh browser. Tab to `link "Search stays"` (→ `/search`), Tab to
   `combobox "Destination"`, type part of a name (listbox opens after `KIP_TYPE_DEBOUNCE_MS` on a page timer, case-insensitive match
   anywhere in the name), ArrowDown + Enter fills the name, Tab to `button "Dates"` and Enter: `dialog "Choose dates"` opens with focus on
   today in the destination's zone by the server clock and `status "Date help"` reads `date.start`; each day button is labelled
   `day.available`/`day.blocked`; Enter picks arrival (Date help reads `date.end` with the minimum stay), Enter picks departure, the dialog
   closes and focus returns to the Dates button, now `Dates, {in} to {out}, {count:night}`. `spinbutton "Children"` ArrowUp adds
   `combobox "Age of child 1"` (default 8). Enter on `button "Search"` → `/search?dest&in&out&adults&ages&lang&cur`; `status "Search
   announcements"` reads `{count:property} found`; each `article` carries `{name}, {stars} stars, score {score}, {distance} kilometres,
   total {amount}`; Enter on a row's name link opens `/properties/<code>?<same query>`. Provider-recorded: none (read-only).
2. **Share and return** (brief: Journeys 2). Filters (`stars`, `amen`, `free`), sort, price range, `Search this area` (`zoom`,`cx`,`cy`), paging
   (`cursor`) each push exactly one history entry; copying the URL into a second browser shows the same rows with focus on `heading
   "Results"`; back/forward re-run the search from the URL and restore scroll (±1 px) and the control with the same `data-focus-key`.
3. **Quote, hold and pay** (brief: Journeys 3). Property page → `button "Reserve"` posts `/api/quotes` and opens `/checkout/<id>`; Reserve there
   posts `/api/holds` (acid-yellow band, `timer "Time left"` `mm:ss` from the server clock; announcements at 5/2/1 minutes); Pay posts
   `/api/bookings` with a fresh `Idempotency-Key`; success → `/bookings/KW-XXXXXX`. Provider-recorded: Postgres booking, rooms, one ledger
   pair (`charge`, guest debit / property credit); a manager rate edit raises `alertdialog "The price changed"`, another traveller taking the
   last room raises `alertdialog "Just taken"`, an expired hold raises `alertdialog "Your hold ended"`.
4. **Arabic and dinars** (brief: Journeys 4). Language `العربية` and currency `KWD` change in place (no reload, URL `lang`/`cur` replaced by one pushed
   entry, filters kept); layout mirrors (`dir="rtl"`), date picker arrows follow reading direction, week starts Saturday; a KWD quote's night
   amounts (converted split) add up to the converted total exactly.
5. **On a phone** (brief: Journeys 5). Filters and Map are bottom sheets (`sheet-open` 240 ms), a map pin selects its row and returns focus to
   that row's `Show {name} on the map`, dates by two taps, gallery swipe ≥ 60 px, Reserve from the fixed price bar, Pay; no sideways scroll at 320 px.
6. **Cancel or change** (brief: Journeys 6). Booking page shows each tier's deadline in the property clock and the browser's (`deadline.line`),
   `status "Refund status"` follows the server on each `clock` event; `Cancel room n` → server refund figure → `toast.cancelled`; ledger gains a
   `refund` pair (property debit / guest credit), balance stays 0, the room's nights return to sale at once (`availability` event). Change dates:
   refused range shows its reason; accepted range shows `change.new_total`, `change.paid`, `change.pay` or `refund.amount`; success writes a `change` pair.
7. **Review** (brief: Journeys 7). `/reviews/<token>` shows `review.early` before completion (11:00 property-local on the checkout date), the form
   within the window, `review.closed` after, `review.used` after one review; the operator publishes at `/moderation`; the property's weighted
   score and rank change at once.
8. **Run the property** (brief: Journeys 8). `/manage/<code>/calendar` keyboard grid, Edit nights dialog, season overlap with `Replace {season}`,
   stop sell; `/manage/<code>/import` Preview/Apply of `KIPRATES 1` files (bytes stored at `imports/<code>/<sha256>.kiprates`, applied in one
   transaction); `/reservations` CSV; `/statements` month table and CSV (`statements/<code>/<yyyy-mm>.csv`, 9 percent).

## 2. Behaviour decisions where the brief is silent

| Topic | Value | Source |
|---|---|---|
| Header `Destinations` target | `/search` | decided: the destination combobox lives there |
| Header `For properties` target | signed-in manager's first `/manage/<code>/calendar`, else `/signin` | decided: no separate marketing page is in the brief |
| Price preview before Reserve | `POST /api/quotes/preview` (same body as quotes, unsaved) | decided: Night Strip needs lines before a quote exists; the brief forbids a quote per page view |
| Quote shown in another display currency | `GET /api/quotes/<id>?cur=` converts with the quote's pinned table | decided: "a quote pins the currency table"; checkout must follow the Currency combobox |
| Change-dates picker ignores the booking's own rooms | `GET /api/dates?property=…&booking=<code>` | brief: Date changes ("ignoring this booking's own rooms") |
| Tier events carry `lang`/`cur` = null | other tabs keep their own language | decided: `account.changed` for a tier change must not switch languages |
| Quote expiry with a live hold | `quote.changed` reason `expired`; pay answers 409 `price_changed` with equal totals, UI shows `price.refreshed` | brief: Checkout dialogs |
| Statement `stay` base | sum of per-night taxable amounts (discounted room amount + breakfast) of non-cancelled rooms | brief: Commission statements |
| Rate limits | per minute of real time, previous minute weighted by overlap (sliding), `Retry-After` in whole seconds | brief: Server boundary ("counted per minute on real time") |
| Map labels | pins whose labels would overlap are drawn one row lower; data positions, clustering and arrow-key rules use the true coordinates | decided: readability of price labels 10–40 km apart on a 250 km view |
| Night Strip rate-state tag | a flat block under the night button (outside the button) | decided: the button's name is `{weekday day month}, {amount}` and must contain its visible text |
| Seed bookings in state `held` | create a live hold and quote; paying that hold fills the seeded booking | decided: keeps one booking per hold |
| Language or currency change in this tab | applied once `PATCH /api/me/preferences` stores it; the select shows the picked option meanwhile | decided: "A change by one tab is stored and broadcast"; this tab switches when the stored value is known, like the others |

## 3. Palette roles (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | #FFFFFF | brief: Visual design ("plain white") |
| surface | #F2F2F2 | brief: Visual design ("very light grey") |
| ink | #000000 | brief: Visual design ("pure black") |
| muted | #595959 | decided: 7.0:1 on white satisfies "dark enough to pass contrast" |
| accent orange | #F25C05 | decided: "bright warm orange"; black text 6.3:1, large text on white 3.3:1 |
| sage | #CDE3C8 | decided: "soft sage green"; black text 15.6:1 |
| acid yellow | #E4FF1A | decided: "acid yellow"; black text 17.8:1 |
| off-white (on black) | #F7F7F2 | decided: "off-white text" on black blocks |
| focus ring | 3px solid #000 (white on black/orange), forced colours `Highlight` | brief: Visual design, Motion and effects |

## 4. Type, space and layout per viewport

| Item | Value | Source |
|---|---|---|
| Latin | Chivo variable 100–900, self-hosted woff2 | brief: Visual design |
| Arabic | IBM Plex Sans Arabic 400/700, 700 where Chivo is 900 | brief: Visual design |
| Scale | 16 / 24 / 36 / 54 / 81 px (×1.5 per step), small text 14 px | brief: "each heading step is one and a half times the step below"; decided: base |
| Totals | weight 900, tabular figures, larger than the name beside them (36 px vs 24 px) | brief: Visual design |
| Corners, shadows, rules | square, none, none (exceptions: `region "Problems"` frame, field outlines) | brief: Visual design |
| phone < 768 | one column; header row 1 wordmark + selects, row 2 links; filters/map as sheets; fixed price bar; vertical hero word | brief: Screens |
| tablet 768–1279 | two columns, map band ≈ ⅓ screen high above rows; two date months | brief: Screens |
| desk ≥ 1280 | three columns (filters ≈ ⅕, rows, map ≈ ⅖ sticky) | brief: Screens |
| 320 | no page scrolls sideways | brief: Screens |
| Targets | ≥ 44×44 px | brief: Visual design |

## 5. Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| Bottom sheet, id `sheet-open` | Filters/Map opened | 240 ms | cubic-bezier(.2,.8,.2,1) | no animation created, sheet appears in place | brief: Motion and effects |
| Gallery, id `gallery-slide` | picture change | 240 ms | cubic-bezier(.2,.8,.2,1) | jumps to the next picture | brief: Motion and effects |
| Night Strip column, id `night-expand` | Enter on a night | 320 ms | cubic-bezier(.2,.8,.2,1) | expands at once | brief: Motion and effects |
| Press / hover | pointer | 80 / 120 ms, named properties only | linear / ease-out | transitions removed | brief: Motion and effects |

## 6. States per async action (brief: Feedback states)

Search, filter, sort, page, map area: rows region `aria-busy`, count in `status "Search announcements"`, notices in `status "Link notice"`.
Destination typing: combobox busy. Date picker load: grid `aria-busy`, blocked reasons in `status "Date help"`. Room override: group busy, refusal in `status "Room
advice"` with previous prices kept. Reserve: button busy; sold out → `alertdialog "Just taken"`; restriction → `status "Room advice"`. Pay: button disabled+busy →
booking page; problems in `region "Problems"`. Cancel/Change/Review/Publish/Edit nights: busy control, `toast.*` in `status "Toast"` for `KIP_TOAST_MS` on a page
timer, refusals as stated. Import: Preview busy → table or error list; Apply busy → `toast.imported`; storage down → `storage.import` in the black `alert` band, preview kept.
Invoice/statement: `storage.doc` in the black band. Pictures: `storage.pictures` in place of the gallery. Sign in/Create account: message under the form.

## 7. Breakpoints

320 (reflow floor), 375 (phone), 768 (tablet), 1280 (desk): brief: Screens.

## 8. Media and licences

| Asset | Made by | Licence |
|---|---|---|
| Harbour town at night (Home) | drawn in code (SVG, client) | original |
| Map coastlines | drawn in code from the destination code | original |
| Property pictures (3 per property) | drawn by the server, stored in MinIO `images/<code>/<n>.svg` | original |
| Chivo, IBM Plex Sans Arabic (woff2) | Fontsource | OFL-1.1 |
| React, ReactDOM, scheduler, pg and its helpers | npm | MIT / ISC (see THIRD_PARTY_NOTICES.md) |
