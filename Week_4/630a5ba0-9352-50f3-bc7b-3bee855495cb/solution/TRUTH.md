# TRUTH — Tidemark Daybook golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flows)

1. **Start a trial** (brief: Journeys 1, DP-01/02). Signed-out visitor on `/` (Sign in) → link "Start a free trial" → `/start`, `form "Start your trial"` (Workspace name, Your name, Email, Password, Time zone prefilled with the browser zone) → "Start free trial" (pending "Creating workspace…", `aria-busy`). Server: `POST /api/workspaces` → 201, cookie `tidemark_session` (HttpOnly, SameSite=Lax), workspace `trialing`, `trialEndsAt` = now + `TRIAL_LENGTH_SECONDS`; outbox item `killbill.register_workspace` tried inline → Kill Bill account (external key = workspace id, name, owner email, USD) + one `daybook-seat-monthly` subscription in bundle `<workspaceId>:<ownerId>`. End: empty Daybook (five columns from today in the chosen zone), banner "Trial: 14 days left", status "Workspace created. Your trial ends on <Day label>." or, with Kill Bill unreachable, "Workspace created. Billing is unreachable, so your seat will be registered when it's back." (`billing:"queued"`; the queue registers it later). Email taken → 409, status + field error "That email already has a Daybook."
2. **Morning ritual** (brief: Journeys 2). Tama signs in → rail step 1 Pull focuses "Add a task"; "Import tasks" dialog uploads CSV → summary in dialog + status. Quick-add with Enter. Step 2 Estimate shows radiogroups (15/30/45/60/90/2h); choosing one PATCHes and the card, mono total and fill update to the confirmed value. Step 3 Check announces "<n> of 5 days are over your threshold." Step 4 Timebox shows the hint above the strip; dragging (pointer, touch long-press 330 ms, or Space + arrows) over another column shows the ghost, hatching and "Over by <n>m"; drop on a column moves at once (PATCH), drop on a slot creates a session (`POST /api/sessions` with a fresh Idempotency-Key). End: block on the strip at its local time and a VEVENT `session-<id>@tidemark` in the feed.
3. **Re-import** (brief: Journeys 3, DP-05). Same CSV again with one edited title and one new row → "Imported: 1 new, 1 updated, 1 unchanged." No duplicates (unique `(member_id, source, external_id)`).
4. **Two devices** (brief: Journeys 4, DP-19). Laptop moves the 10:00 session to 11:00 (`PATCH /api/sessions/{id}` version 1 → 200). Phone moves it (still version 1) → 409 `version_conflict` with `current` = winner → block snaps to 11:00, status "Couldn't move <title>: it was changed on another device. Showing the latest time."
5. **Evening shutdown** (brief: Journeys 5, DP-27/28). Step 5 opens `dialog "Shut down"` (Done / Carry over to <Day label> / Tomorrow starts with) → "Send shutdown" (pending "Shutting down…") → open cards of today move to the top of tomorrow, sessions deleted, unique `digests(member_id, local_date)` row + mail outbox item → "Day shut down. Digest sent to <email>." Second shutdown same day → "Day shut down. Today's digest was already sent.", no email.
6. **Run the studio** (brief: Journeys 6, DP-30/31/33/34). Workspace page: invite → member `pending_billing` + `killbill.add_seat` item → seat accepted → `invited` + invite email (link `<origin>/join/<token>`) → 201 "Invite sent to <email>." Remove → Kill Bill seat cancelled IMMEDIATE, member `removed_at` set, sign-ins deleted, feed 404 → "Removed <name>. Active seats: <n>."; Kill Bill down → 503 and nothing changes. Review: Previous/Next week changes `?week=YYYY-Www`.
7. **Feed** (brief: Journeys 7, DP-24/25/26). Settings → Copy feed URL ("Feed URL copied.") → Rotate feed URL → `alertdialog "Rotate feed URL?"` → Rotate (pending "Rotating…") → new token, old URL 404 text/plain at once.
8. **Operator** (brief: Journeys 8, DP-38). Operator sees only Operations: Workspaces table (Workspace, State, Trial ends, Seats "<active> / <billed or —>", Queued, Last import); no task, meeting or routine names anywhere.

## Palette (decided hexes for the brief's colour roles; brief: Visual design)

| Role | Hex |
|---|---|
| paper ground | `#F6F1E6` |
| ink | `#17251F` |
| ink-soft (secondary text) | `#4B5C53` |
| sand rule / card border | `#D8CBAE`; hairline `#E4DAC4`; hour line `#C7B693` |
| sand-ink (field borders, meeting border, gauge outline) | `#7A6A48` |
| pine accent (current step, fills, session blocks, one primary per non-Daybook screen) | `#1F5240` |
| brick overload (hatch, over label) | `#A33A28` |
| ghost | pine 45 % mixed into paper, dashed pine top edge |

## Type, space, layout

- Fraunces Variable (soft axis) for headings: h1 28 px, h2 22.4 px (day headings ≈1.4× body), h3 17.9 px — each level 1.25× the one below (brief: Type). IBM Plex Sans 16 px body; IBM Plex Mono with tabular numerals for every number.
- Spacing 8/16 rhythm, 2 px radius, no shadows or gradients; hatching and ruling are SVG patterns (decided: brief forbids gradients).
- 1280: gutter 216 px (rail + Backlog) | five columns | 268 px sticky strip. ≤1100: rail row, Backlog full width, columns, strip below. ≤600: rail row scrolls, Backlog cards collapsible, five slim gauges with short headings and "Show" buttons, the shown day's cards below the row, tables as stacked cards (brief: Screens and layout).
- Gauge 134 px; tidemark at 5/6 (100%/1.2); fill height = min(planned/threshold, 1.2) × tidemark height; ghost = estimate/threshold × tidemark height stacked on the fill, clipped at the top; calendar slot 44 px, block height = minutes × 44 / 30 (brief: Waterline).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| buttons, slips | hover/press | 150 ms (background-color, border-color) | cubic-bezier(.22,1,.36,1) | instant |
| Waterline fill, hatch | planned change | 300 ms height | same | instant |
| ghost | enter / leave column | 260 ms height grow / shrink (WAAPI) | same | appears/disappears instantly |
| mono total | value change | 420 ms counting via registered `--num` integer | same | jumps |
| rollback slide | refused move | 400 ms transform (FLIP) | same | instant |
| dialogs | open / close | 220 ms in (opacity, translateY 8 px); close is instant | same | instant |

Nothing loops; nothing animates while idle (brief: Motion and effects).

## States per async action

Exactly the brief's Feedback states table: pending copy on the triggering button with `aria-busy`; outcomes in the single `status` region "Planner updates"; field errors under fields via `aria-describedby`; rejection reasons mapped from API codes.

## Breakpoints

600 px and 1100 px (decided: separate the brief's 375, 768 and 1280 arrangements).

## Media and licences

Fonts: Fraunces, IBM Plex Sans, IBM Plex Mono — OFL-1.1, self-hosted woff2 from Fontsource. Icons: lucide-react (ISC). Favicon: original SVG. Listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
