# TRUTH — Halide Box Office golden

The brief made concrete. `brief: <section>` = copied verbatim; `decided: <why>` = the brief is
silent and the choice follows its intent. Design tokens live in `DESIGN.md`; this file names the
values the build uses.

## Journeys (ideal end-to-end flows)

### 1. Browse the programme (DP-01–DP-06)
- Start: `/en/` with the seed; stage order = scheduled/member-priority/on-sale seasons by first screening date, then slug (brief: Stage geometry).
- Scroll y: segment k = min(N−1, floor(y/1000)), p = min(1000, y − 1000k); o, rotation 40·o, radius (D/2)(0.04+0.96o), f-stop list 22…1.4, rail v, tint t exactly per brief: Signature: Iris Pull. Attributes `data-segment … data-context` on `region "Programme stage"` are updated synchronously in the scroll handler (decided: the verifier pauses the page clock, so no frame loop decides them).
- Active season k when p ≥ 300 else max(0, k−1); on change: `?season=<slug>` (history.replaceState), `html[data-active-season]`, tab `aria-selected`/`aria-current`, one polite announcement `<title> — <n> screenings` (n = all screenings of the season, `1 screening` for one) (brief; decided: n counts the season's screenings as `/api/seasons` reports them).
- Deep link / tab activation → y = 1000k + 700 instantly; unknown slug → top. Reduced motion: unsegmented stage, selected season fully open (`1.000`, `40.0`, round(D/2), `1.4`, `1.000`, `0.000`), instant tab swap.
- WebGL unavailable → SVG iris, `svg`/`none`; context lost → SVG at once, `svg`/`lost`; restored → `webgl`/`ok` within 1 s.
- Language button swaps strings in place (no reload), `history.replaceState` prefix, `html lang`, `POST /api/locale`, cookie `halide_locale`; seat map moves ≤ 2 px (decided: fixed-height single-line elements above the grid, `scrollbar-gutter: stable`).
- Sale times: priority 10:00 Toronto three calendar days before the public sale date, public 10:00 Toronto on it; shown as `Members book from <date> 10:00 · Everyone from <date> 10:00 (Montréal time)` (brief).

### 2. Guest buys tickets (DP-07–DP-15)
- Seat map → `POST /api/holds` (guest cookie `halide_guest`) → `/en/checkout/<hold id>`, countdown = expires_at − (Date.now() + offset from the hold's server_time), ticking each second.
- Quote on every change (`POST /api/holds/<id>/quote`); pay `Pay <amount>`; checkout with one `Idempotency-Key` per page visit.
- Kill Bill: account `guest-<lowercased email>` with `__EXTERNAL_PAYMENT__` default and AUTO_PAY_OFF (decided: payments are made explicitly so a failure can be voided); one draft invoice with `EXTERNAL_CHARGE <ref> ADM <fare> x<q>`, `TAX <ref> GST <fare>`, `TAX <ref> QST <fare>`, `EXTERNAL_CHARGE <ref> UPLIFT`; committed (Kill Bill applies credit); remainder paid by one PURCHASE with payment external key = booking ref.
- One commit: booking `paid`, tickets, hold.booking_ref, credit spend pair, outbox `booking-confirmed:<ref>`, stored idempotent response. Any Kill Bill failure → 503 `billing_unavailable`, invoice voided (now or when billing returns), hold unchanged, key freed.
- End: `Booking confirmed` page (tickets, price summary, `We'll email your confirmation to <email>.`), one confirmation email with `Manage your booking: <APP_PUBLIC_URL>/<locale>/b/<token>`.
- Booking-link form always answers 202; a matching paid guest booking gets a new token, the old one dies, email `booking-link:<ref>:<n>`.

### 3. Member books in priority by keyboard (DP-16–DP-22)
- Member fares: `member` once, `member-guest` up to the allowance (1/2/3); defaults member, member-guest…, regular (brief: Fare rules; shared in `src/shared/fares.ts`).
- Credit balance > 0 → quote `stepup_required` true and checkout 403 until `POST /api/stepup/verify` succeeds for the session (valid STEPUP_VALID_SECONDS).
- Step-up: 6-digit code, TTL STEPUP_CODE_TTL_SECONDS, 4 wrong → attempts_left 4,3,2,1, 5th → lock STEPUP_LOCKOUT_SECONDS; sends ≥ 30 s apart; ≤ 4 sends per rolling window; answers in < 5 s (waits ≤ 3 s for SMTP acceptance, else `queued`).
- Worked example 2 with 2500 credit: total 3030, credit 2500, pay 530; ledger spend pair; Kill Bill CBA 2500 → 0.

### 4. Join and change membership (DP-23–DP-27)
- Join: subscription `<tier>-<cadence>` (bundle key per attempt), first invoice awaited and paid; `Membership active` + Kill Bill invoice amount; email `membership-started:<A-…>:<n>`.
- Upgrade (higher tier): `billingPolicy=IMMEDIATE`, Kill Bill's prorated invoice returned verbatim (items without CBA_ADJ, credit applied, paid); downgrade or cadence change: `END_OF_TERM`, `pending_change` with `effective_date = charged_through`, nothing charged. Conflicts: not_member, gift_membership_locked, change_pending, no_change. Every tier change needs step-up.

### 5. Give a membership (DP-28–DP-30)
- Gift: one invoice `EXTERNAL_CHARGE <gift ref> GIFT <tier>` = annual price; emails `gift-receipt:<ref>` (purchaser locale) and `gift-delivered:<ref>` (recipient locale, link `/<locale>/gift/<token>`).
- Redeem: gift row locked; one subscription `<tier>-gift` (FIXEDTERM 12 months, fixed 0.00); invoice 0.00; token dead afterwards (`not_found`).

### 6. Group outing (DP-32–DP-35)
- Group hold 10–40 seats (session required), fare `group` only; payers 2–6, seats sum = hold seats; shares from the Kill Bill invoice amount by largest remainder (17 seats → 18569 → 6554/6554/5461).
- Door: window showtime − 45 min ≤ now < showtime + 30 min; conditional UPDATE decides each ticket once; door list keys exactly ticket_code, seat, initial, status, booking_ref.

### 7. Programme a season (DP-36–DP-39)
- draft → scheduled (needs a screening) → time-derived scheduled/member-priority/on-sale; on-sale → archived (no future screenings); scheduled/on-sale → withdrawn (reason). Weekly slots keep Toronto wall-clock time (gap +1 h, repeated hour → EDT).
- Withdrawal: ends live holds (`ended_by season`), refunds each paid booking in its own commit (Kill Bill refund, email `Season withdrawn: <title>`, `refund` audit), then `season-withdraw` audit with the total.

### 8. Finance day (DP-40–DP-47, DP-50)
- Lookup by HB-/T-/HG-/A- (case-insensitive, trimmed). Refund: cutoff showtime − 2 h; paid portion → Kill Bill REFUND (key `<ref>-refund`), credit portion → account credit `<ref> RECREDIT` + reversal pair. Goodwill 100–50000: credit `GOODWILL <audit id>`, goodwill pair, audit entry.
- Reconciliation: Toronto day window, local vs Kill Bill PURCHASE/REFUND (tenant payments filtered to the app's accounts), accept with reason on mismatch. CSV per brief with formula neutralisation.
- Enquiry reply: outbox `enquiry-reply:<ref>:<n>` in the enquiry locale, audit `enquiry-reply` (reason = subject).

## Billing probe

- Every 5 s each instance reads `GET /1.0/kb/catalog/versions` with the tenant credentials; a connect failure or a 10 s timeout means `billing: down` (brief: Services, When unreachable). decided: Kill Bill's health endpoint is never polled, because its queue statistics are unsynchronised and concurrent pollers leave it failing for the service's lifetime.

## Navigation after an action

- Hold → checkout, pay → booking page, release → screening, sign-in/sign-up → return path, account guards and sign-out move in place with `history.pushState` and a client re-route; no document reload (decided: brief Interactions says "goes to checkout" / "the browser goes to the booking page" without a reload, and a reload would drop the in-flight status copy and race a patron's next navigation). A return path without a locale prefix falls back to a full load.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | #0B0A09 | decided (brief: near-black booth) |
| surface / surface-2 | #15130F / #1D1A15 | decided |
| ink | #EEE6D6 | decided (brief: warm off-white) |
| muted | #A79E90 | decided (brief: warm mid-grey) |
| line | #7A7266 | decided (control boundary ≥ 3:1) |
| amber | #F2A33A | decided (brief: tungsten amber, live state only) |
| danger | #F26B5E | decided (brief: clear red) |
| season tints | #1A0B0C oxblood, #081413 blue-green, #17110A umber, cycling | brief: tints in season order; decided hex |

## Type, space, layout

- Instrument Serif display, Inter body 16 px / 1.5, IBM Plex Mono for every number (brief: Type). Steps 19.2 / 23.04 / 27.65 / 33.18 px (×1.2); season title clamp(48px, 7.5vw, 96px) (brief: six times / three times body).
- Space 4–96 px scale, 12-column grid with 24 px gutter (16 px under 768), 44 px minimum targets, header 64 px (decided).
- 1280: stage full viewport, title lower-left, f-stop right mid-height, tabs under the header, rail 2/2/5/1/2 columns; screening 4/8; checkout 7/5 with sticky summary; console 7/5. 768: rail title on its own line; stacks. 375: Menu button, two-line rail cards, Film notes button, seats ≥ 44 px panning in their frame, single-column console (brief: Layout by viewport).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| dialogs, menus, notices, panels | appear | 280 ms opacity + translateY 6 px (`element.animate`) | cubic-bezier(0.45,0,0.55,1) | instant |
| Service notice | leave (recovery or dismiss) | 280 ms, the same keyframes reversed, then `hidden` | same | instant |
| dialogs, menus | leave (Escape, Close, choice, Tab) | 280 ms, the same keyframes reversed (brief: Interface motion, "reverse when they leave"); focus returns to the opener at once (brief: Dialogs, Option menus) while an inert, aria-hidden copy plays the fade (decided: both rules hold together) | cubic-bezier(0.45,0,0.55,1) | instant |
| amber edge on rail rows, seats, buttons | hover / focus | 260 ms box-shadow, border-color | same | instant |
| uplift switch thumb | toggle | 240 ms transform | same | instant |
| hold countdown | every second | step | — | same |
| iris, f-stop, rail, tint | scroll | linear in scroll | none | static fully open |

## States per async action

Button disabled with `Working…`/`En cours…` (pay: `Processing payment…`), status region announces it; success copy in the status region; API errors in the alert region verbatim with field messages under fields (`aria-describedby`); outage: Service notice (billing / mail paragraphs), money-moving buttons disabled while billing is down; mail-delayed line on confirmations while mail is down (brief: Feedback states).

## Breakpoints

< 768, 768–1279, ≥ 1280 (brief: Layout by viewport).

## Media and licences

All imagery procedural (WebGL/SVG iris, CSS seat states, SVG screen arc): `original`. Icons: Lucide (ISC). Fonts: Instrument Serif, Inter, IBM Plex Mono from Fontsource 5.3.0 (OFL-1.1), woff2 vendored in `app/src/client/fonts/` (copied to `dist/public/fonts/` at build) and listed in `app/assets.json`.
