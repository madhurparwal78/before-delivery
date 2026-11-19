# TRUTH — Tramela Estate golden

The brief made concrete. Every value says where it came from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

1. **Lead's morning check.** Start: signed out, desktop. Wrong password once → `alert` reads `Email or password is wrong.`,
   Password empty, focus on Email (brief: Interactions, Sign-in). Right password by keyboard → address `/estate` (brief: Landing and redirects).
   Map shows clusters `Cluster of 4 shops in Centro, zoom in`, `3 … Sul`, `3 … Norte` and lone markers for São Miguel and Terceira
   (brief: Business rules, Regions and clusters). Unchecking Open, Closing soon, Closed leaves `?state=stock_critical,suspended`
   (one history entry each) and announces `<n> shops shown.` (brief: Estate filters in the address). Selecting Loja Faro Centro glides to
   `-7.9304,37.0194,6.00` and opens `region "Shop detail"` with focus on its heading. Suspend with a reason → `Loja Olhão is suspended.`
   Scrubber arrow keys move 0.010. Back re-checks Closed. Sign out → `/sign-in`; Marta Lopes signs in without a reload: the estate shows only
   Casa Lusa's 10 shops and nothing from Grupo Atlântico (brief: Sign out and switching person). Provider record: `sign_in_attempts`
   cleared for the email; `sessions` row per sign-in.
2. **Shopper finds and orders the marine varnish.** Catalogue search `tinta`, `%`, `verniz` (literal matching, applied a third of a second after the last keystroke, 333 ms; brief: Interactions, Catalogue and product);
   product page, area Lisboa then Faro re-ranks in place (`12 shops ranked from Faro.`); Add to cart counts the total up and announces
   `Cart total 24,90 €.` once. Checkout: choose shop, `Hold items` (`Items held at Loja Faro Centro.`), reload keeps the countdown from the
   server's `seconds_left`, hold ends → `Your hold has ended. Hold again to keep these items.`, `Hold again`, day, time, name, email,
   `Place order` → `/orders/<id>`, focus on `Order <number>`, `Order messages` reads `Order <number> placed. Collect at <store> on <date> at <time>.`
   Provider records: `orders`, `order_events` seq 1, `order_view`, object `orders/atlantico/<number>.json`, one message in Mailpit.
   Lost answer: the first `Place order` commits but its answer drops; a press after a reload (the cart now has no hold) resends the saved `Request-Key` and body, the first answer replays and the shopper lands on the order page; one order, one message (brief: Request keys in the browser).
3. **Till sale against an online basket.** Till sale with a retry under one `Request-Key` lowers stock once; the open checkout re-reads every
   5 s, marks the line `Only 0 left at Loja Olhão.`, counts the total down in place and announces it once; `Hold items` opens `Stock changed`
   with focus on `Remove line`; removing returns focus to `Hold items`. The lead's estate re-reads every 5 s and renames the marker
   `Open Loja Lisboa Baixa, stock critical, critical lines: 1` on the same node.
4. **Fulfilment and return.** `Start picking <n>` → `Mark ready <n>` → `Hand over <n>`, focus on the next legal action each time; `Start return <n>`
   opens `Return items`; a poll never disturbs it; `Request return`, `Return label <n>` stores the label once, `Receive <n>` puts the unit back in stock,
   `Settle <n>` refunds exactly (`500, 500, 499` cents on a 3 × 4,995 € line).
5. **Azores hours from tomorrow.** `Effective from` starts at the shop's `local_today`; draft survives reload; publish → `Opening hours published from <date>.`,
   `New hours start on <date>.`; previews show today's old hours, tomorrow's new times with the Azores offset, and 2027-03-28 without the missing hour.
6. **Care agent.** `Find order` by email, `Show more orders` appends and focuses the first new link, order page with history `#<seq> <type> <YYYY-MM-DD HH:mm>`
   in Lisbon time, `Verify history` → `History verified: <n> entries.`, `Download order document` saves exactly the stored bytes.
   Storage down → `status "Storage notice"` and the document control `aria-disabled` with `Order documents are unavailable until storage returns.`
7. **Lead on a phone.** 375 × 812, reduced motion: Map/Table tabs, one-finger pan, pinch to zoom 8, filter sheet and header menu open and close, table
   `Details for …` switches to the Map tab and cuts straight to the shop (`data-phase` settled, no `moving`).
8. **Session ends during checkout.** `Place order` after the session lifetime → `/sign-in?next=%2Fcart%3Fcheckout%3Dopen` with `Your session ended. Sign in to continue.`;
   same account signs in → checkout restored open from its first frame with every value and focus on `Place order`; the saved `Request-Key` and body are resent; exactly one order.

## Palette (hex the build uses)

ground `#B3122F`, raised `#8F0E26`, ink `#FFFFFF`, muted `#FFD3DA`, accent `#FFE4E8`, accent-pressed `#FFCBD3`, charcoal `#1E1E22`,
charcoal-line `#4A4A53`, land `#3A3A42`, focus `#FFE4E8` (carmine on the landing white panel), danger `#7A0B20`,
state fills open `#8EE6B0`, closing soon `#FFD45C`, closed `#9096A0`, stock critical `#FF7B54`, suspended `#FFE4E8` with hatch `#B3122F`.
Source: brief: Visual design (roles); hex decided in DESIGN.md with AA ratios.

## Type, space, layout

- Big Shoulders (headings only, uppercase, 800; h1 2.441rem, h2 1.953rem, h3 1.5625rem, h4 1.25rem) and Public Sans (everything else, 1rem/1.5, tabular figures). brief: Visual design, Type.
- Radius 6px; targets ≥ 44px; focus ring 3px solid pale pink offset 3px (carmine on the landing white panel). brief: Visual design.
- Breakpoints 375, 700 (back office two columns, estate full-width map with sheets), 768 (header in one row, product two columns), 1200 (back office three columns, estate columns, care side by side, cart totals right), 1280 (landing pinned words at their largest; decided within brief: Landing hero geometry). brief: Screens and layout.
- Landing: pinned words 9.5rem / 7rem / 4.75rem, `mix-blend-mode: difference`, `pointer-events: none`; corner distances 12 px / 8 px (limits 48/32/24). decided within brief: Landing hero geometry.

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| map selection glide | select a shop | 640 ms (0.56–0.72 s) | 1 − (1 − t)^5 | cut at once, settled | brief: Motion |
| detail panel | after glide settles | opens 170 ms later | — | opens at once | brief: Motion |
| drag glide | release a drag | half-life 240 ms, stop under 0.5 px/s | exponential | stops dead | brief: Motion |
| cluster separation | zoom crosses 3 | 280 ms per marker, 40 ms stagger, ≤ 12 starts | ease-out | straight to placed | brief: Motion |
| order arrival | new `order.placed` event | drop 420 ms, pulse 600 ms | ease-in, ease-out | static ring 600 ms | brief: Motion |
| figures | value change | 360 ms | ease-out | at once | brief: Motion |
| ranked list | new ranking | 280 ms | ease-out | at once | brief: Motion |
| hold meter | each shown second | 250 ms | linear | at once | brief: Motion |
| sheets, dialogs, panels, sections, storage band | open / close | 200 ms | opacity fade | at once | brief: Motion |

## States per asynchronous action

Sign in: `Signing in...` → landing / `Email or password is wrong.` / `Too many attempts. Try again in <minutes> minutes.`; shop list, product search, ranking,
cart change, hold, place order, order row action, return actions, count, till sale, publish hours, preview, order search, show more, verify: the copy in the brief's
Feedback states table, each in its named status region; outage copy for Place order, Download order document and Return label.

## Media and licences

Big Shoulders and Public Sans variable fonts (OFL-1.1, Fontsource, self-hosted), Natural Earth 1:10m coastline (public domain), landing drawings and favicon drawn for
the app (original). No photographs, no icon library, no third-party requests at run time.
