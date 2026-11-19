# TRUTH — Saltmoon Practice Lanternfish (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys

1. **Applicant enrols** (brief: Journeys 1, DP-01..07, DP-61, DP-70)
   - Start: `/` lists cohorts in `enrolling` or `baseline`, ordered by first night; each card (`article "<name>"`)
     shows name, coach, phase label (`Enrolling`, `Baseline – week <w> of 4`), `Nights <starts_on> – <starts_on+27>`,
     `$<price>` (comma thousands), `1 seat left` / `<n> seats left` / `Full` (Enroll disabled) (brief: Placeholders).
   - Enroll → `/enroll/<id>`: form `Enroll in <name>` (Your name, Email, Home time zone from `GET /api/time-zones`
     preselected to the browser zone when listed, else `UTC`, Usual bedtime). Draft/unknown/malformed id →
     `Cohort not found` / `We couldn't find that cohort.` Invalid → 422 messages under each field; nothing created.
   - Continue to payment → `POST /api/enrollments` 201 (`pending_payment`, 24-character code) → `/enrollments/<id>`:
     `Payment pending`, `Your access code: <code>` (only on this navigation, kept in history state; decided: the
     brief shows it only right after continuing), status `Your seat is not reserved until payment is confirmed.`
   - Pay `$<price>` → status `Confirming payment with the billing provider.`, button disabled → Kill Bill account
     looked up by externalKey = enrollment id (reused if present, `__EXTERNAL_PAYMENT__` default method added when
     missing), payment looked up by external key (a SUCCESS PURCHASE is reused), otherwise one PURCHASE
     (`<id>-purchase`, amount price/100 USD) → `Enrolled`, `A receipt is on its way to <email>.`,
     `Your first night: <d> – bedtime <b>, wake alarm <w>.`, `Open my logbook` (signs in with the code it still
     holds, else `/signin?next=%2Flogbook`; decided).
   - A foreign or `null` Origin, or `Sec-Fetch-Site: cross-site` without Origin → 403 `cross_origin`; nothing in Kill Bill.
   - Provider record: one account, one SUCCESS PURCHASE; Mailpit: one receipt with exactly the seven brief lines,
     `Amount paid` from the SUCCESS PURCHASE amount.
2. **First night** (brief: Journeys 2, DP-71): `/logbook` signed out → `/signin?next=%2Flogbook` → access code →
   `GET /api/landing` decides the landing → `/logbook`; Tonight panel `Night <n> of 28 – <key>`, bedtime, wake alarm,
   capture-window line from `GET /api/me/night`; current section shows the empty copy; Save entry →
   `Kept on this device` → `Saved` with `Logged HH:MM` in the home zone under the server's night.
3. **Travels west** (brief: Journeys 3, DP-69, DP-72): Night settings → new zone → `night_held` true →
   `Night settings saved. You're still on night <n> until your next bedtime.`; night key = max(derived, latest entry key).
4. **Offline capture on a shared phone** (brief: Journeys 4, DP-73): offline banner in `status "Connection"`; entries
   and memos kept in IndexedDB stamped with the enrollment id; Sign out offline clears the remembered session at
   once, shows sign-in and queues `DELETE /api/session` as the first request on reconnect; another dreamer never
   sees, counts or sends them; on the owner's next load kept non-rejected entries are sent in writing order, then
   memos, then `Synced: <saved>. Kept on this device: <kept>.` in `status "Sync"` (re-announced every attempt).
5. **Tag and drill** (brief: Journeys 5, DP-30..39, DP-63, DP-75, DP-83): select text in `Entry text` (read-only
   contenteditable textbox, whole-text UTF-16 offsets), Tag as dream sign or `T` → dialog (Inner awareness checked and
   focused) → confirm → `data-phase` underline → flight → settle → idle, legend + sky description + `<Category> signs: <n>.`;
   overlap → `refused` → idle and `That phrase overlaps a sign you already tagged.`; drill targets the server's
   `target_category` captured at opening; `Log reality check` → `Reality check logged. Checks this night: <n>.`
6. **Coach runs a cohort** (brief: Journeys 6, DP-65, DP-66, DP-76): `/coach?cohort=<id>` is the selection (push on
   choose/create; no `cohort` value → earliest by starts_on (ties by name), address replaced without history and no
   copy; a value that is not one of this coach's cohorts (unknown, malformed or another coach's) → the same fallback
   plus `That cohort isn't available.` in `status "Coach updates"` (brief: Feedback states, Screen state));
   create draft (name clash, case-insensitive → `You already have a cohort with that name.`) → publish; roster
   refreshes in place every 30 s while visible.
7. **Refund and digest** (brief: Journeys 7, DP-67, DP-68, DP-78): Refund dialog → Kill Bill REFUND (`<id>-refund`,
   reused if one exists) → row `Refunded`, sessions ended, shares gone, seat freed everywhere; digest → one Mailpit
   message → `Digest sent to <email>.`; second press → `This week's digest was already sent to <email>.`
8. **Payment outage** (brief: Journeys 8): 503 `billing_unavailable`, alert copy, still pending, nothing in Kill Bill.

## Rules (each decided once, server side)

| Rule | Where | Source |
|---|---|---|
| phase/week | `domain/cohorts.ts cohortPhase` | brief: Business rules |
| night key (max of derived and latest entry key), held night, capture window (open until 14:00 next day), wake alarm (+5 h), bedtime 20:00–23:59, accepted zones | `domain/time.ts` | brief: Business rules |
| memo types, signatures, byte ranges | `domain/memos.ts` | brief: API |
| sign-in landing | `domain/landing.ts` | brief: Business rules, Sign-in landing |
| halo 12 + 36·min(n,28)/28 half-up; target with tie order | `domain/signs.ts` | brief: Business rules |
| roster aggregates, recall rate half-up 2 dp | `domain/roster.ts` | brief: Business rules |
| check orders (enrol, pay, entry save, refund) | `routes/*.ts` | brief: Business rules |

The browser renders server values only (Tonight panel, legend counts, halos, target, roster).

## Palette (decided values in the brief's roles; DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground | #0B0A1F | brief: Visual design |
| panel / raised | #14123A / #1C1A47 | brief: Visual design (a shade lighter) |
| ink | #DEDAF5 | brief: Visual design (~85 % lavender-white) |
| muted / line / line-strong / disabled | #9C99C8 / #4A4880 / #6E6BA8 / #7E7BAA | brief: Visual design (slate-indigo) |
| violet / violet fill | #B8A4FF / #9C84F5 | brief: Visual design (actions, focus rings) |
| teal | #6EF0DC | brief: Visual design (signs and current night heading only) |
| rose | #D98FAE | decided: rejection and outage lines |

## Type, space, layout

- Fraunces (400, 500 for h1) headings; Atkinson Hyperlegible 400 body; 17px / 1.7 body; h4 20.4, h3 24.5, h2 29.4,
  h1 35.3 px (× 1.2 per level); nothing above 500 (brief: Type; decided weights).
- Spacing 4px grid, 32px between entries, 48px between nights; controls ≥ 44 × 44 (brief: Density, Controls).
- Breakpoints (brief: Screens and layout): < 768 phone (96px horizon strip → full-screen sheet; cohort grid 1 col;
  coach combobox + roster cards); 768–1199 tablet (280px band pinned, journal scrolls beneath; 2 cols; tablist);
  ≥ 1200 desktop (560px journal column scrolling on its own, sky fills the rest, legend chip lower right; 3 cols;
  320px coach column).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| button hover/press | pointer | 100 ms | cubic-bezier(0.16,1,0.3,1) (brief: every motion starts fast and slows gently into place) | none |
| dialogs, sheet in / out | open / close | 250 ms in (opacity + 12px rise) / 180 ms out (opacity + 6px drop) | cubic-bezier(0.16,1,0.3,1) both ways (brief: every motion starts fast and slows gently into place) | instant |
| fog drift | idle, page visible | 60 s cycle (closed loop, decided: seamless repeat inside the brief's 40–80 s) | constant drift, no start or stop within a cycle | still |
| underline | confirm | < 120 ms | — | at once |
| phrase flight (overlay canvas) | confirm | 120–760 ms | ease-out cubic, quadratic curve | skipped |
| star gather + halo growth | confirm | 760–1060 ms (or at confirm if later) | ease-out cubic | star fades 100 ms, halo jumps |
| refused particles | server refusal | 330 ms (brief: about a third of a second) | ease-out cubic | no particles; underline removed |
| legend + announcement | settle | max(1060 ms, server confirm + dreamscape) | — | at confirm |

Brief: Motion and effects. No WebGL: 2D still picture of the same stars and halos (brief).

## States per async action

As the brief's Feedback states table; every message persists in its named live region until replaced
(decided: never auto-dismissed). Unnamed failures (decided): network loss on sharing, drill and settings shows a
"needs a connection" line in the same region.

## Media and licences

Fonts: Fraunces, Atkinson Hyperlegible (OFL-1.1, Fontsource 5.3.0 woff2). Icons: Lucide paths inline (ISC).
Sky, strip miniature and empty-night crescent are drawn in code. No other media.
