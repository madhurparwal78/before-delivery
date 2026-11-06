# TRUTH — Mela

design_direction: original (Mela's own bright, airy, celebratory direction)

The brief (`instruction.md`) is the authority. This file records how the golden in `solution/app` meets it:
the ideal flow of every journey, then every design value, each marked `brief: <section>` when the brief
states it or `decided: <why>` when the brief names it only in words or is silent. Where the brief names a
colour in words, the hex is the value the golden chose for that role, deepened where AA contrast requires
it, as the brief allows ("even where that means deepening a shade described here").

## Journeys (ideal flow)

### J1 — Visitor finds an event, signs up while asking to join, sees Pending (brief: Journeys 1)

1. `/discover` renders on the server: `Discover Events`, `Coming Up` `All cities`, twelve category tiles,
   `Community Calendars`, `Events by City` (brief: Discover).
2. The visitor presses the `Gurugram` city tile: the list region shows shimmer rows, the server renders the
   filtered page, the list, category and city regions swap in place and the address becomes
   `/discover?place=gurugram` (decided: plain links enhanced, so they also work without scripts).
3. `Games` → `/discover?place=gurugram&category=games`, label `Games in Gurugram`, `Founders Board Game Night`.
   Back restores `?place=gurugram`.
4. `/gamenite`: amber theme, `Approval Required`, `Request to Join`, `Register to See Address`, `Gurugram`,
   meter `1 of 40 places taken` / `39 places left` (seed: Ravi approved, Lena pending).
5. `Request to Join` as a visitor stores the press in `sessionStorage` and goes to `/signin?next=%2Fgamenite`
   (brief: Interactions "The page remembers the press in the browser across the sign-in").
6. `/signin`: `Email` → `Continue with Email` → unknown → `Name` + `Password` → `Create Account` →
   `POST /api/auth/signup` (201, HttpOnly SameSite=Lax cookie) → `/gamenite`.
7. The card replays the remembered press: `POST /api/events/gamenite/register` → `pending`; toast
   `Request sent to the host` replaces the welcome toast; card `Pending Approval`, `Cancel Request`.
   Provider: one `registrations` row, status `pending`. `/home` lists it with the `Pending` pill.

### J2 — Host runs a small approval event (brief: Journeys 2)

1. `/create` (visitors: `302 /signin?next=%2Fcreate`). The host fills the form, `Require Approval` on,
   `Capacity` 2, `Waitlist Enabled` on, `Create Event` → `POST /api/events` (201, UTC times, 8-char slug)
   → `/{slug}` with toast `Your event is live`. An invalid submit marks the field `aria-invalid`, shows the
   API's message beside it and keeps every typed value.
2. Three `pending` requests. `/manage/{slug}`: `Approve` twice (toast `Approved <name>`); the third answers
   409 `event_full` → `Event is at capacity` beside the row; `Decline` → `declined`.
3. The approved guest reloads: `You're In`, street address, `Open in maps` (`geo:` link), celebration once
   (claimed on the server). The declined guest: `Registration Declined`, no address, no action.
4. Capacity 1 → 422 `Capacity cannot be lower than the 2 guests already going` beside `Capacity`; 3 → saved.
5. `Remove` → `declined`; that guest's next load has no address (every event response is `private, no-store`).
6. Database drops: the next `/manage/{slug}` is the 503 short-break page; `Try Again` after recovery works in
   the same session (sessions live in PostgreSQL).

### J3 — Register and cancel at once (brief: Journeys 3)

`/runclub7` as Ravi: `Register` → button disabled, card `aria-busy` → 201 `approved` → toast
`Registered. See you there!` → the server re-renders the card, location and guest regions, swapped in place;
`Registration status` announces `You're In`; focus stays in the card; the card swells; the meter slides;
confetti plays once. `Cancel Registration` → toast `Registration cancelled`, going count back down.

### J4 — Access code (brief: Journeys 4)

Landing `firework shows` → `/fireworx` (night): `Access Code Needed`, `I have an access code` reveals
`Access code` (focused) + `Submit Code`. Wrong → 403 → `That code is not valid` beside the field
(`aria-invalid`, `aria-describedby`). `GLOW-2026` → 201 `approved`, address shown, fireworks.
Five wrong codes → the sixth answers 429 + `Retry-After` and `Too many attempts. Try again in 15 minutes.`

### J5 — Follow and contact (brief: Journeys 5)

`Follow Chapterhouse Readers` → `PUT /api/calendars/chapterhouse/follow` → button `Following`, toast; the
community page shows the count one higher. `/zinefest` `Contact the Host` opens a modal dialog (focus on
`Message`, Tab trapped); `Send` carries one `Idempotency-Key` per opening; a failed send keeps the dialog and
text with the outage alert, a resend uses the same key, the host gets one row.

### J6 — Move up from the waitlist (brief: Journeys 6)

A new member `Join Waitlist` on full `/potterya` → `You are 1st in line.` Lena `Cancel Registration` → the same
transaction promotes the first waiter; toast `Registration cancelled · <name> moved up from the waitlist`. The
promoted member's next view: `You're In`, `A place opened up, so you moved up from the waitlist.`, address,
celebration once.

## Palette

| Role | Hex | AA pair | Source |
|---|---|---|---|
| ground | #ffffff | | brief: Visual design (near-white page) |
| ink | #151515 | 18.3:1 | brief: Visual design (near-black ink) |
| muted | #5e5e5e | 6.5:1 | brief: Visual design (softer grey) |
| hairline / quiet fill | ink at 10% / 6% | non-text | brief: Visual design (pale translucent grey) |
| quiet hover | #5b5b5b, text #ffffff | 6.8:1 | brief: Motion and effects |
| link / pressed | #1463e0 / #0d4fb8 | 5.4:1 / 7.4:1 | brief: Visual design (vivid mid blue that deepens) |
| magenta / amber | #d6136c / #b45c00 | 5.0:1 / 4.7:1 | brief: Visual design; decided: deepened for AA |
| violet | #9b3fd1 | 5.2:1 | brief: light violet in small accents; decided: deepened |
| green | #1d7a3e | 5.4:1 | brief: hero link turns green |
| warning / danger | #8a5a00 / #b3261e | 5.9:1 / 6.5:1 | decided: brief silent |

### Event themes (one `data-theme` on `<body>` sets every themed value)

| Theme | Ink | Wash | Accent | Strong (labels, meter, primary button) | Button text | Source |
|---|---|---|---|---|---|---|
| amber | #2a1704 | #fdf4e6 | #e0901c | #9c5800 | #ffffff 5.5:1 | brief: warm near-black, soft orange |
| harbor | #03192a | #ebf5fb | #3aa0d8 | #13618f | #ffffff 6.7:1 | brief: cool near-black, soft cyan |
| moss | #161812 | #f1f3ec | #8a9478 | #4f5a3c | #ffffff 7.3:1 | brief: neutral near-black, deep olive grey |
| plum | #1a0f33 | #f2eefc | #9d85ef | #5f3fc4 | #ffffff 7.0:1 | brief: muted indigo-black, light indigo |
| ember | #2d0c0a | #fcefed | #ec6a5a | #a8352a | #ffffff 6.6:1 | brief: muted red-black, soft red |
| night | #ffffff | #0a1235 | #8fa8ff | #8fa8ff | #0a1235 8.0:1 | brief: the one dark theme |

Night status colours (decided: AA on the dark ground): link #9cbcff, danger #ff8a80, green #6fdc95,
warning #ffc266, card surface #141e4d.

## Typography

| Token | Family | Weight | Size / line | Source |
|---|---|---|---|---|
| sans | "Avenir Next", Avenir, "Segoe UI Variable Text", "Segoe UI", Seravek, Ubuntu, Cantarell, system-ui, sans-serif | | | brief: one humanist sans with a system fallback |
| body | sans | 400 | 16px / 26px | brief: comfortable size, roomy lines |
| label / meta | sans | 500 / 400 | 14px / 20px, 13px / 18px | brief: a step smaller |
| card-title | sans | 600 | 20px / 26px | brief: about a quarter larger, semibold |
| hero | sans | 600 | 80px (≥1024), 64px (601–1023), 48px (≤600), 44px (≤360) / 0.95 | brief: about five times body wide, three on phones |
| event-title | "Iowan Old Style", Palatino, Georgia, serif | 600 | 48px, 36px at ≤900 | brief: optional serif display face |

## Space, shape, depth

| Token | Value | Source |
|---|---|---|
| spacing | 4px scale; ≥48px between sections | brief: Density and touch |
| radius | inputs/rows 10px, cards 16px, content cards 24px, pills 999px, avatars 50% | brief: Shape and depth |
| card shadow | 0 1px 2px rgb(0 0 0/.06), 0 4px 14px rgb(0 0 0/.06) | brief: soft shadow |
| pill shadow | four layers: 0 1px 1px /.08, 0 4px 6px /.10, 0 12px 24px /.16, 0 24px 48px /.12 | brief: deep layered shadow |
| avatar ring | 0 0 0 1px hairline | brief |
| blur | header and quiet buttons: backdrop-filter blur(16px) saturate(1.4) | brief |
| touch | every control ≥44px | brief: Density and touch |
| focus | 2px solid theme ink, offset 3px | brief |

## Layout per viewport

| Viewport | Landing | Discover (events / categories / cities) | Event page | Manage | Source |
|---|---|---|---|---|---|
| 1280x800 | covers ring the headline (6 each side) | 2 / 4 / 3 | two columns: cover + aside (Presented by, Hosted By, going, guests, quiet links) left; chip, h1, date tile, time, countdown, location, card, About Event, Location right | table beside edit form | brief |
| 768x1024 | 64px headline, covers in two loose columns | 2 / 3 / 2 | one column (≤900): cover, title, date, countdown, location, card, About Event, Location, Hosted By, guests, links | stacked | brief |
| 375x812 | 48px headline, covers in a loose cluster under the buttons | 1 / 2 / 2 | as above | each guest a card | brief |
| 320 | no sideways scroll | | | single-column tracks are `minmax(0, 1fr)`; the edit preview cover shrinks to 88px on phones and `Shuffle Theme` may wrap | brief |

## Motion

| Token | Duration | Easing | What | Reduced motion | Source |
|---|---|---|---|---|---|
| fade | 170ms | cubic-bezier(.2,.7,.3,1) | colour, background, shadow, opacity | instant | brief: about a sixth of a second |
| pop | 280ms | cubic-bezier(.34,1.56,.64,1) | menu, date tile, switch, dialog | end state | brief: under a third of a second |
| rise | 800ms | cubic-bezier(.16,1,.3,1) | hero lines: translateY + clip-path opening from bottom centre | end state | brief: under one second |
| word cycle | every 2500ms (timer), the new word plays `rise` | as rise | `Joyful`, `Cozy`, `Lively`, `Bright` | stays `Joyful` | brief |
| scatter | scroll-linked | linear | each cover moves away from the headline centre by a third of its size and fades to 0.5 over one screen | covers at rest | brief: Signature interaction |
| wash | 500ms | ease-out | opacity of the glow + grain layer | none | brief: about half a second |
| shimmer | 1200ms loop | linear | skeleton rows, only while loading | still pale fill | brief |
| swell | 360ms | spring | card scale 1 → 1.012 → 1 | none | brief: under half a second |
| meter | 330ms | cubic-bezier(.2,.7,.3,1) | translateX of the fill | jumps | brief: about a third of a second |
| tick | 260ms | spring | a changed countdown number | none | decided |
| toast | 220ms in, 160ms out, 5000ms life, stack pauses on hover/focus | ease-out | transform, opacity | no movement | brief |
| celebration | pieces 1300–2300ms, layer gone ≤2.9s | WAAPI | ≥40 confetti in ≥3 colours from the card, two corner cannons and a shower; night: 5 shells × 14 sparks + 20 sparks | never plays | brief: Celebration |

## States

| State | Treatment | Source |
|---|---|---|
| Registration card | one template `_card.html`, state from `pages.card_state` | brief |
| empty | line icon, one sentence, action | brief: Empty states |
| loading | shimmer rows in the discover list; busy buttons + `aria-busy` | brief |
| error | beside the field, `aria-invalid` + `aria-describedby`; sign-in one `role=alert` | brief |
| outage in-page | `role=alert` beside the control with the brief's copy; control re-enabled | brief |
| success | toast, at most three, newest last | brief |
| denied / not found | 404 page; host-only pages 404 | brief |

## Media

| Need | Produced by | Alt | Licence |
|---|---|---|---|
| covers | CSS layered gradients from theme vars + per-slug positions, name lettered via `attr(data-name)` | `<event name> cover` | original |
| avatars | initials on a tinted circle | hidden beside names | original |
| icons | inline line SVG (pin, chevron, sparkle, hash, up-right arrow, door, calendar, clock, users, mail, flag, lock, globe, close, check) | hidden or named | original |
| grain | SVG feTurbulence data URI | decorative | original |
| sparkle mark | `static/mark.svg` | `Mela` | original |

## Data and concurrency

| Rule | Enforcement | Source |
|---|---|---|
| serialized registration changes | `SELECT … FOR UPDATE` on the event row in register, cancel, decide and edit; counts read after the change in the same transaction | brief: Concurrency |
| one registration per member and event | `UNIQUE (event_id, member_id)`; re-register reuses the row | brief |
| queue order | `queued_at` (set on each entry to `waitlisted`), then id | brief: Queue order |
| promotion | `registrations.promote`, same transaction, only waitlist on + no approval + not ended | brief |
| lockout | `access_code_failures` single-statement upsert under the event lock; lock times use `clock_timestamp()` (the moment of the fifth failure), not the transaction start, so `retry_after` never exceeds the window | brief |
| send once | partial unique index (member, event, key) + `ON CONFLICT DO NOTHING` + body compare | brief |
| follows | `PRIMARY KEY (member_id, calendar_id)` + `ON CONFLICT DO NOTHING` | brief |
| address privacy | `events.load` sets `sees_address`; JSON drops the keys; templates branch on it | brief |
| outage | per-request connection; `OperationalError` → 503 page / JSON with `Retry-After: 5`; health connects each call | brief |

## Brief values not carried

| Value | Why |
|---|---|
| measured vivid magenta and amber | deepened to #d6136c and #b45c00 so gradient text meets AA |
