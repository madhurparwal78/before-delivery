# TRUTH: Ivo Kastrel Casebook

Ground truth for `app/` (Flask 3.1 + Jinja, plain JS, PostgreSQL via psycopg 3, gunicorn gthread ×3).
Each value says `brief: <section>` (copied) or `decided: <why>` (the brief is silent). Values were read from
`app/app.py`, `store.py`, `rules.py`, `visuals.py`, `templates/`, `static/site.css`, `site.js`, `studio.js`, `boot.js`.

## Ideal flow of every journey

### 1. First look (DP-52..56, DP-61..63)
1. Start: fresh browsing session, `GET /` → 200, eight `section`s `#hero #about #services #work #process #journal
   #awards #contact`, each labelled by its heading; everything readable with scripting off. brief: Screens and layout.
2. `boot.js` (head) adds `motion` (Motion on, no reduced-motion request) and, on the first page of the session
   (`sessionStorage["ik-intro"]` unset), `intro`: the fixed full-viewport cover (`.intro-cover`, outside `main`,
   `aria-hidden`) shows `Ivo Kastrel` on `#070707`, holds 900 ms (page clock), lifts by `translateY(-100%)` over
   700 ms with `pointer-events:none`, removed at 1700 ms. Never again that session; skipped under reduced motion or
   Motion off. brief: Intro cover; decided: timings.
3. Scrolling: the `h1` statement `IT WAS ALWAYS GOING TO BE THIS WAY` slides left by
   `0.25 × innerWidth × min(scrollY / heroBottom, 1)`, read every animation frame (decided: scroll events can arrive a frame late or not at all, so the line could lag where the page stands) whenever motion is on, at every width; back to 0 at
   the top. The smoky blot (`.smoke`) sits over its middle letters. brief: Signature interaction.
4. Chapter headings (`[data-split]`) are split into word spans; when in view each word goes opacity 0 → 1,
   blur 10 px → 0, translateY .5em → 0 over 520 ms with 70 ms stagger (index capped at 8). brief: Motion.
5. `VIEW` (under the selected work, hint `Scroll down for more`) → `/work`, five cards numbered `01`–`05`.
   No stored side effect.

### 2. Filtering and following the work (DP-32..38)
1. `/work`: `nav "Discipline filter"` links `All` `/work`, `UI/UX` `?discipline=ui-ux`, `3D WEB`
   `?discipline=3d-web`, `FRONTEND` `?discipline=frontend`; current one `aria-current="true"`, underlined, bold,
   white border, scrim fill. `status "Catalogue status"` reads `<n> case studies shown.` / `1 case study shown.`
2. Click → `site.js` fetches the link's HTML, swaps `[data-catalogue]`, the filter markers and the count, then
   `pushState`. `popstate` repeats the swap for Back/Forward. A failed fetch → `location.assign(url)`.
   Unknown, empty or repeated `discipline` on `/work` → 302 `/work`. brief: Discipline filter.
3. `3D WEB` lists Hollow Signal `01`, Vanta Atelier `04` (ordinals from the full set). Empty discipline →
   `Nothing here yet.` + `link "See all work"` → `/work`. brief: Feedback states.
4. `/work/hollow-signal`: place `01 / 05`, `Previous: Low Tide Radio`, `Next: Ember Ledger`, `All work` → `/work`.

### 3. Reading the journal (DP-39..41)
`/journal` (or the home journal chapter) → `Motion Beyond Animation` → `/journal/motion-beyond-animation`: `h1`
title, `July 1, 2026`, excerpt as lede, four body paragraphs, `All journal entries` → `/journal`. An entry is public
when `published AND published_on <= (now() AT TIME ZONE 'Pacific/Auckland')::date` (`store.public_journal`, the
only place). brief: Public visibility.

### 4. Sending an inquiry (DP-42..49, DP-57)
1. `Let's Connect` → `showModal()` on `dialog "Let's Connect"` (full screen, `#111111` sheet rising from the bottom
   over 500 ms; content fades in, never moves). Form is reset, focus to `Name`. Tab / Shift+Tab wrap inside.
2. `Submit` → JSON `POST /api/inquiries` (same origin), `project_type` omitted for `No preference`; button
   disabled, status `Sending your message…`.
3. 422 → every typed value kept, `aria-invalid="true"` + message beside each field (`aria-describedby`),
   `alert "Inquiry errors"` heading `Check the highlighted fields.` + one link per field (focuses it).
   Nothing stored. Outage → `Your message could not be sent. Try again in a minute.`
4. 201/200 → fields hidden, `status "Inquiry status"` holds the focused (`tabindex=-1`) thanks
   `Thanks, your message is in. I reply within two working days.`; row in `inquiries` with `status='new'`,
   `received_at = clock_timestamp()`.
5. Escape or `Close` → dialog closes (slides down 320 ms, click-through while closing), focus to `Let's Connect`.
   Reopen → empty form. brief: Inquiry dialog.

### 5. Curating the studio (DP-01..10, DP-17..22, DP-31, DP-50, DP-51)
1. `/studio` with no token in `sessionStorage["ik-studio-token"]` → `location.replace("/studio/login")`. The `/studio`
   HTML is static and carries no record data. brief: Gate.
2. Sign-in: `Sign in` disabled + `Signing in…`; 401 `Email or password is incorrect.` / 429 `Too many sign-in
   attempts. Try again later.` in `alert "Sign-in errors"`, email kept; 200 → token stored for the tab → `/studio`.
3. `/studio`: `region "Case studies"` (table, `Create draft`), `form "Case study editor"` (hidden until opened),
   `region "Inquiries"`, `button "Sign out"`, `status "Studio status"`, `alert "Studio errors"`.
4. `Create draft` → empty editor, `Save draft` → POST → `Draft created.`, row reads `Draft`. Refusal 422 → fields
   marked with the API messages, `Check the highlighted fields.`, values kept; 409 → `That slug is already in use.`
5. `Publish <title>` → `Published.` (row `Published`, `published_at` = `now()`), lists on `/work` with the next
   ordinal; `Unpublish <title>` → `Unpublished.`; `Edit <title>` → slug shown as read-only text, `Save` sends only
   changed fields → `Saved.`; `Delete <title>` → `Deleted.`. Table refetches after every action.
6. `Mark resolved <name>` → `Marked resolved.`; on 409 → `This inquiry is already resolved.` and the row refreshes
   to `Resolved`. Any 401 → token forgotten, `/studio/login`.
7. `Sign out` → `POST /api/auth/logout` (204, `revoked_at` set), token removed, `/studio/login`.

### 6. Guess, stale token, shared draft (DP-02, DP-04..06, DP-09, DP-11..14)
- Five refusals for an email (trimmed, lowercased) inside `SIGN_IN_LOCKOUT_WINDOW_SECONDS` (900) after its last
  success → 429 with `Retry-After` = seconds until the fifth-newest refusal leaves the window (1..window); every
  attempt with a well-formed body writes one `sign_in_attempts` row; known and unknown emails identical
  (unknown emails check against a dummy hash). Decided once in `store._locked`.
- A token is valid while `revoked_at IS NULL AND now() < expires_at`; `expires_at = now() +
  SESSION_LIFETIME_SECONDS` (43200) at sign-in, never moved. `sessions.token` stores the SHA-256 of the bearer
  token (decided: a leaked table opens nothing).
- Drafts, unknown slugs, uppercase, trailing-slash, percent-encoded (raw path ≠ decoded path) and numeric forms all
  404 with one fixed body (`{"error":"Not found."}` / the not-found page, heading `Nothing at this address.`).

### 7. Restart (DP-23, DP-24)
`store.prepare` runs under `pg_advisory_xact_lock` in one transaction: `CREATE TABLE IF NOT EXISTS` for the eight
tables, then the seed only when `accounts` is empty. Owner deletes/edits survive every restart.

## Palette

| Role | Hex | Source |
|---|---|---|
| page field, footer base | `#070707` | brief: Colour roles (near-black neutral) |
| panels, dialog, studio, cards | `#111111` | brief: Colour roles (one step lighter) |
| selected fill, table head, menu | `#1a1a1a` | decided: second step for selected states |
| deep blood red: hairlines, borders, figures band, stage grid, glows | `#990000` | brief: Colour roles; never text |
| bright red: focus ring, error marks, live dot, equaliser, footer glow | `#d60407` | brief: Colour roles |
| live dot flash | `#ff4a3d` | brief: Colour roles (hotter, lighter) |
| dark warm red, gradients only | `#440004` | brief: Gradients |
| body text | `#f3f1f0` | brief: Colour roles (near-white) |
| mark, close cross, statement, figures, headings | `#ffffff` | brief: Colour roles |
| muted text | `#c8c0bd` | brief: Colour roles (light warm grey) |

Large script words are near-white with a `#990000` glow (the deep red may not be text on the page field).
Gradients: footer `linear-gradient(172deg, #070707 0 48%, #440004 68%, #d60407 100%)`; hero three blurred radial
glows (deep red upper left, deep red bottom centre, `#440004` near the top) at .7 opacity; awards field
`#070707 → #120000 → #440004` over a triangle-faceted floor (two 45° gradients, 96 px tiles, `rotateX(70deg)`).
Generated visuals (`visuals.visual`): four compositions (glow + angled linear, ring tunnel, conic wedge, angled
bands) chosen by the case study's `position` (so catalogue neighbours differ) or a hash for other records; angle,
glow position, reach, stop, ring spacing and 7 of the 16 stage-grid hairlines from SHA-256 of the stored fields.
Meaningful ones are `role="img"` `aria-label="Generated artwork for <title>"`; the rest `aria-hidden`.

## Type, space and layout

| Token | Value | Source |
|---|---|---|
| families | sans `"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif`; script `"Brush Script MT", "Segoe Script", "Snell Roundhand", "Apple Chancery", cursive`; no font file | brief: Type |
| statement | 80px / .9, weight 100, uppercase, nowrap (64px ≤ 1100px; 32px wrapping < 600px) | brief: Type (≈5× body; ≈⅓ on phone) |
| display (chapter `h2`, page `h1`) | 56px / .95, weight 100, uppercase (36px < 600px) | brief: Type (≈3.5× body) |
| body / lede / label | 16px/1.6 · 20px/1.5 weight 300 · 13px tracked uppercase | decided |
| script sizes | figures 96px (64 phone), JOURNAL 104px (120 on /journal; `min(72px, 15vw)` < 600px so a wider fallback script face never scrolls sideways at 320), 3D WEB 52px, closing words 52px, ordinals 36–44px | brief: Type (≥ ≈2× body) |
| spacing | chapters `min-height:100vh`, block padding `clamp(96px,12vh,160px)`, gutter `clamp(20px,6vw,96px)` | brief: Composition |
| touch targets | every control ≥ 44×44 | brief: Composition |

| Viewport | Layout | Source |
|---|---|---|
| 1280×800 | full nav top right with status pill above it; hero intro top-left, statement across, roles bottom-right; figures band 3 columns; 3 service cards; selected work alternating left/right around the centred stage square; journal cards staggered (middle raised 80px); case stage 1 : 1.6 : 1; studio table + editor side by side | brief: Viewports |
| 768×1024 | nav folded behind `Menu`; services, journal, awards and /work cards two across; figures 3 columns; studio editor below the table | brief: Viewports (nav folds < 900) |
| 375×812 | one column; statement 32px wrapping above intro and roles; figures and services stacked; form full width; studio rows become stacked cards | brief: Viewports (one column < 600) |

## Motion

| Element | Trigger | Duration / easing | Reduced-motion or Motion-off substitute | Source |
|---|---|---|---|---|
| split heading words | enters view (IO) | 520ms `cubic-bezier(.2,.7,.2,1)`, 70ms stagger | shown at once | brief |
| hero statement | scroll | linear, direct step | still at start | brief |
| dialog sheet / content | open | 500ms `cubic-bezier(.16,1,.3,1)` / 380ms fade +120ms | instant | brief |
| dialog close | close | 320ms `cubic-bezier(.4,0,1,1)` translate down | instant | brief |
| card hover | hover | 250ms lift 4px + brightness 1.12 | brightness only | brief |
| journal cover | hover / focus-visible | 250ms brightness .5 → 1 | instant | brief |
| /work covers, service pictures | enter view | 1100ms clip-path unveil from bottom | shown | decided |
| intro cover | first page of session | hold 900ms, lift 700ms `cubic-bezier(.7,0,.2,1)` | skipped | brief |
| live dot | always | 1500ms ease-in-out loop | still | brief |
| equaliser bars | always | 900/1150/1400/1050ms alternate | mixed still heights | brief |
| plus markers, process rings | always / process in view | 20s linear loop | still | brief |
| hero glows, smoke | hero in view | 18s/22s/20s/16s alternate | still | brief |
| grain | hero in view | 600ms steps(5) | still | brief |

Exactly these five loop kinds exist. Hero and process loops pause (`animation-play-state`) out of view. All motion
rules require `html.motion`; `@media (prefers-reduced-motion: reduce)` also forces `animation/transition: none`.
Motion button: starts `aria-pressed="true"` even under reduced motion; off writes `localStorage["ik-motion"]="off"`.

## States per async action

| Action | Pending | Success | Field error | Refusal / outage |
|---|---|---|---|---|
| inquiry | Submit disabled, `Sending your message…` | thanks in status, focused | messages + summary links | `Your message could not be sent. Try again in a minute.` |
| sign in | `Signing in…`, disabled | `/studio` | beside Email / Password | API reason; `Sign-in is unavailable. Try again in a minute.` |
| studio actions | pressed button disabled | `Draft created.` `Saved.` `Published.` `Unpublished.` `Deleted.` `Marked resolved.` | editor fields + `Check the highlighted fields.` | API reason; `That change could not be saved. Try again in a minute.` |
| studio load | `Loading the catalogue…` / `Loading the inbox…` | rows | — | `The studio is briefly offline. Try again in a minute.` |
| filter | list unchanged | swapped + count | — | full page load |
| server outage | — | — | — | API 503 refusal; health 503 `{"status":"unavailable"}`; pages 503 `The studio is briefly offline. Try again in a minute.` |

## Breakpoints

| Width | Change | Source |
|---|---|---|
| ≤ 1100 | statement 64px, process 2 columns | decided |
| < 900 | `Menu` button, nav panel, two-across cards, studio editor below | brief |
| < 600 | single column, statement 32px wraps (still slides with motion on), flat award cards, stacked studio rows | brief |
| 320 | no sideways scroll (`overflow-x: clip`, `overflow-wrap:anywhere` on data) | brief |

## Data and API facts

- Status codes as the brief's API table; brief: Error precedence. `app.guard` answers route 404/405 (an encoded
  form of an address with no slug or id is no route) → 413 → database reachable → bearer 401; then each handler
  415 → 400 → 404 (unknown id or slug, including an encoded slug or id path, via `app.exact_slug`) → 429 → 422 →
  409 → publish 422. So an unauthenticated encoded studio id gets 401, as the brief's order puts 404 at step 6.
- One refusal builder `app.refusal`; framework errors mapped in `framework_error`; unexpected → 500 `Something went wrong.`
- Catalogue order, ordinals, totals and neighbours: `store.catalogue` only. Editable fields and the publish
  requirement: `rules.EDITABLE_FIELDS`, `rules.publish_problems`. Duplicate window (60 s, advisory lock per
  lowercased email): `store.receive_inquiry`.

## Media and licences

No media files ship (IF-03). All visuals are generated (`original`); all icons inline SVG drawn for the app.
Packages: see `app/THIRD_PARTY_NOTICES.md` (BSD-3-Clause, MIT, Apache-2.0/BSD-2, PSF-2.0, LGPL-3.0 psycopg).
