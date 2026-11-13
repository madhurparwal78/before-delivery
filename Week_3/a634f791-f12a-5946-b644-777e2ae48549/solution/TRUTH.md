# TRUTH — Northfall Reference Desk

Ground truth for the golden in `app/` (Flask + gunicorn, psycopg 3 and tzdata against Postgres, server-rendered
Jinja pages, `static/site.js` for public routes, `static/desk.js` for `/desk`, one `static/site.css` set inline in each page head).
Every value is marked `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief
is silent; the reason ties it to the brief's intent).

## Journeys: the ideal flow

### 1. A prospect reads the library (DP-06..DP-13, DP-57)

1. `GET /` renders on the server: the wordmark, `h1` "References you can check, from installations we
   actually finished", the line "Every story here is published with the customer's written agreement",
   the lime link "Start an enquiry" (`/contact`) and the underlined link "Read the references"
   (`/references`). brief: Public screens and controls
2. Below the promise line, and painted behind it, the featured strip lists the first three live
   references in ordinal order: big serif ordinal `01`, sector tag, title, headline figure, arrow; each is a
   link to its detail. On scroll the strip travels upward and its rows pass beneath the line, which moves a
   quarter as far. brief: Screens and layout, Motion; decided: the strip is a hairline list on the ground (DP-49)
3. One customer quote (the first live reference carrying a quote; seeded: Hanna Lehto, "Maintenance
   manager, Aspen Mills") and three service panels: "Nominating an installation", "How a customer clears a
   story", "Asking for a reference call". brief: Screens and layout
4. `/references`: `h1` "The reference library", the count line "3 cleared references", `navigation
   "Sectors"` with "All sectors" then `food`, `ports`, `pulp` (alphabetical, live sectors only), and one
   hairline row per live reference: `01 Harbour crane retrofit · ports · 99.2 % Crane availability`, `02
   Dairy line rebuild …`, `03 Paper mill drive swap …`. Rows are server-rendered. brief: Screens and layout
5. "food" loads `/references?sector=food` as a full page: "1 cleared reference in food", the `food` link
   carries `aria-current="true"`. A sector held by no live reference (withheld, draft, other programme,
   unknown) shows "0 cleared references in <value>", no link marked current, and the empty state; the main
   region is identical apart from the value. brief: Business rules (Sector filter)
6. "Suomi" goes to `/fi/references?sector=food` (same row, Finnish chrome, `aria-label="Toimialat"`,
   first link "Kaikki toimialat", count "1 hyväksytty referenssi toimialalla food"). brief: Interactions
7. `/references/dairy-line-rebuild`: `Reference 02 · food · Vuono Dairy`, the title, the summary as lede,
   "The challenge", "The work", "The result" with three figure pairs (`dt` label, `dd` value, value shown
   above label), then the lime "Ask about this reference" (`/contact`). The head carries `<title>`, `meta
   description` (the summary) and `og:image` = `APP_PUBLIC_URL/static/img/social-preview.png`.
   brief: Screens and layout, Browser support and performance
8. `/programme`: `h1` "How the programme works", quick navigation `navigation "Chapters"` (links named exactly "Nomination", "Clearance", "How long a clearance
   lasts", "Changes and removal" to `#nomination`, `#clearance`, `#duration`, `#changes`), four chapters
   with header buttons inside their headings (`aria-expanded`, first open with script, all open without), each body holding a link, a pull quote (Joonas Hirvi) and figure pairs, then the
   terms of participation at `#terms`. `/story`: `h1` "The programme so far", four dated chapters 2014–2016 … 2023–2026, each with an
   eyebrow span, serif heading, a described 640×400 photograph and sans paragraphs; a pull quote (Leena Varjo)
   and figure pairs. `/notes`: "2 notes", then 14 September 2026 "What a clearance covers" and 2 June 2026
   "Why we number the library"; the draft note is absent. brief: Screens and layout

### 2. A prospect leaves an enquiry (DP-17..DP-21)

1. `/contact`: `h1` "Talk to the reference desk"; left the form (textbox "Work address" required,
   "Telephone" optional, combobox "Reference of interest" starting "No particular reference" then the live
   titles, checkbox "I agree to the privacy statement" required, button "Send the enquiry"); right "The
   reference managers", six cards (copy buttons aligned at each card's foot); the privacy statement (`#privacy`) sits under the form in the left column. brief: Public screens and controls
2. Submit: the `alert` region empties (field messages stay until the answer), button disabled with label "Sending…", `POST /api/enquiries` with `email`,
   `agreed`, and `phone` / `reference` only when filled. brief: Feedback states; decided: blank optional
   fields are omitted so an empty telephone is not refused
3. `201`: the server-rendered `status` region, outside the form, fills in teal: "Thank you, the desk will reply from
   hello@example.com"; the form goes; focus moves to the region. brief: Feedback states
4. `422`: the `alert` region reads "Check the marked fields and send again."; each `errors` key fills its field's message
   (linked by `aria-describedby`, `aria-invalid`), others clear, typed values stay, focus goes to the first failing field
   (form order). Finnish routes show the Finnish table's messages. brief: Feedback states
5. Network failure or 5xx: the `alert` region above the button: "The desk cannot take enquiries right now. Nothing
   was sent; please try again shortly."; field messages and typing stay; the button rests again. brief: Feedback states
6. Stored: one `enquiry` row (`programme_id` northfall, trimmed address, `agreed` true, `open` true). A repeat
   from the same address (trimmed, case-folded) while open answers `201` with the same `id`; simultaneous
   ones serialise on `pg_advisory_xact_lock(2, hashtext(programme || lower(address)))`, backed by the partial
   unique index `one_open_enquiry_per_address`. brief: Business rules (Enquiries)

### 3. A prospect copies a manager's address (DP-22, DP-73)

Enter, Space or a click on "Click to copy address" writes the address with `navigator.clipboard` and swaps the label to
"Copied to the clipboard" for 2 s from the latest activation, each card on its own timer, focus staying on the button. A
refused clipboard shows "Copy not available" for the same period and selects the card's address text. brief: Interactions;
decided: 2 s is inside the published 1.5 to 2.5 s

### 4. A curator drafts and publishes (DP-23..DP-32, DP-55, DP-59, DP-60, DP-74..DP-80, DP-92)

1. `/desk` shows `form "Sign in"`. `POST /api/auth/login` returns `{"token","role"}`; the token is 32 random url-safe
   bytes, stored as its SHA-256 in `desk_session` with `signed_in_at` on the service clock; the client keeps it in
   `sessionStorage`. On success the panel goes, the list is read and focus moves to the "References" heading. Any failure:
   `401 {"message":"The address or password is not right"}` in the panel's `alert`. brief: API, Interactions; decided:
   sessions are a `desk_session` table
2. Totals line `3 live, 1 withheld, 1 drafts, 0 retired`; `list "References"`: live first by ordinal, then Finnish
   alphabetical order; each row ordinal (or "not live"), title, sector, state word and its buttons, all from
   `GET /api/desk/references`; rows are kept and updated in place across re-reads. brief: The desk, Feedback states
3. "New reference" opens `form "Reference editor"` (focus "Title"); "Create the draft" answers "Saved", the editor stays
   on the draft, focus "Add a figure", the button becomes "Save the reference". Figures: "Figure N label/value", "Remove
   figure N", "Figures n of 6". Publish without a window: "Record a clearance window before publishing". After a steward
   records a window, Publish: "<title> is published", focus "Retire <title>". brief: Interactions, Feedback states
4. "Move <title> up/down" sends `PUT /api/desk/order` with ordinal ∓ 1, one request however often pressed; the list is
   re-read, rows slide (200 ms), focus stays on the pressed button (or the other move button when it became disabled);
   "<title> moved to position N of M". A refusal re-reads and says "The order could not be changed"; focus on the pressed
   button if it still exists, otherwise the row's Edit button. brief: Interactions
5. Every Save sends `If-Match` with the editor's version; 412 keeps the typing and shows the message. A 401 keeps the
   editor, shows the sign-in panel above it, says "Your session has ended. Sign in to finish." and focuses "Email"; after
   sign-in to the same programme the action retries once with its original payload; to another programme it is discarded
   and the editor closes. brief: Interactions

### 5. A reference leaves the library (DP-15, DP-16, DP-31, DP-37, DP-58, DP-71, DP-84)

Retire sets `published = false, retired_at = now`, deletes its preview links and takes a version; narrowing a window, a
content change that voids the window (`figures`, `quote`, `quote_speaker`, `quote_role`, `customer`) or the date passing makes the
reference fail `LIVE`. `settle_run` drops it and closes the gap; every public read filters by the same predicate; earlier
slugs answer 404 while it is not live. Reopening or restoring appends it last with its history intact. brief: Business rules

### 6. A customer reviews a preview (DP-33..DP-35, DP-61, DP-82, DP-83)

"Make a preview link for <title>" mints a 43-character token (604,800 s by default; `expires_at` in the published form,
after now and at most 2,592,000 s ahead) and deletes earlier links; "Desk messages": "Preview link ready: <APP_PUBLIC_URL>/references/<slug>?preview=<token>
(expires d.m.yyyy hh:mm)". The page opens under "Preview: the reference is not published", without the enquiry link, with
`Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and `<meta name="robots"
content="noindex">`; only the language links carry the token. Valid at its expiry second, refused one second later;
publish and retire delete links; any refused preview is the standard 404. brief: Business rules; decided: a retired link
is deleted, which reads exactly like one that never existed

### 7. A Finnish reader browses (DP-38..DP-40, DP-87..DP-89)

The page blueprint is mounted at `/` and `/fi`; the reads API at `/api` and `/api/fi`. `<html lang>` is `en` or `fi`; the head
carries `<link rel="alternate" hreflang>` to the other language with the raw query; the switch ("Suomi" / "English") points
to the same address and, on `/programme`, follows the fragment. `harbour-crane-retrofit` shows "Satamanosturin
modernisointi" and its Finnish body; others show the English text (`lang="en"`) under "Tämä tarina on vielä kääntämättä".
Every string in the brief's Finnish table lives in `copy.py`. `navigation "Primary"` keeps its printed name, since the table
gives no Finnish form. brief: Business rules, Published Finnish copy

## Palette

| Role | Value | Used for | Source |
|---|---|---|---|
| ground | `#f2efe9` | page ground, sticky header, all text on inverted panels, role lines included | brief: Visual design › Colour (warm off-white) |
| ink | `#1c1a17` | text, ordinals, figures, focus ring, rows under pointer | brief: Colour (near-black, warm) |
| secondary | `#57524b` | secondary text only: eyebrows, figure labels, dates, meta lines, role lines on the page ground; ledes, paragraphs and the count line are ink | brief: Colour (deep warm grey for secondary text; near-black ink for text) |
| deep | `#2e2b27` | directory card bodies, cookie notice, preview band, desk bar | brief: Colour (inverted panels) |
| deep-rule | `#bdb6ab` | button borders and link underlines on deep; never text, which is ground | decided: a visible border on the inverted panels |
| quiet | `#6f6961` | index row title at rest (4.7:1) | brief: Space and composition |
| lime | `#ddf29b` | every enquiry call to action (`.cta`) | brief: Colour |
| red | `#d1281f` | current-page dot (the only current-page marker) | brief: Colour |
| hairline | `#d5cfc5` | rules between rows and sections, above each pull quote's text and each figure pair | brief: Colour |
| control | `#8f887e` | input and chip borders (3:1), always solid | decided: visible borders |
| paper | `#f9f7f3` | fields, desk surface | brief: Colour |
| teal / tint | `#2e7d6b` / `#dcefe8` | enquiry confirmation, desk success | brief: Colour |
| brick | `#9e3a2a` | field errors | brief: Colour |

## Type

| Step | Family | Weight | Size / line height (wide → narrow) | Used for | Source |
|---|---|---|---|---|---|
| display-xxl | Source Serif 4 (self-hosted, SIL Open Font License 1.1) | 300 | 4.5rem / 0.98 → 2.5rem | promise line | brief: Type (≈4× / 2.5× body) |
| display-xl | Source Serif 4 | 300 | 3.5rem / 1 → 2.25rem | page `h1` | brief: Type |
| display-l | Source Serif 4 | 300 | 2.75rem / 1.02 → 2rem | section and chapter headings, figure values | brief: Type |
| display-m | Source Serif 4 | 300 | 2rem / 1.05 → 1.75rem | index row titles, pull quotes | brief: Type (rows ≈2× body) |
| display-s / xs | Source Serif 4 | 300 | 1.5rem, 1.25rem | `h3`, manager names | brief: Type |
| paragraph-l / m | Inter (self-hosted, SIL Open Font License 1.1) | 500 | 1.1875rem / 1.55, 1rem / 1.6 | ledes, prose, controls, the whole desk | brief: Type |
| eyebrow | Inter | 500 | 0.8125rem, uppercase, 0.08em | eyebrows | brief: Type (small capitals labels) |

Headings letter-spacing -0.015em. decided: Source Serif 4 is a transitional serif and Inter a grotesque,
both under the SIL Open Font License 1.1.

## Layout per viewport

| Viewport | Inset / gap | What changes | Source |
|---|---|---|---|
| ≥ 1100 (1280×800) | 64 / 32 px | hero one column with strip rows in one line; panels three across; contact form left, directory right with cards three across; desk editor beside the list | brief: Responsive behaviour |
| 640–1099 (768×1024) | 40 / 24 px | panels and cards two across; hero and contact stack; nav shown, no Menu; desk editor below its row | brief: Responsive behaviour |
| ≤ 639 (375×812, 320) | 20 / 16 px | nav behind "Menu"; rows wrap: ordinal + sector, title, figure; one column everywhere; form above directory; desk editor below its row | brief: Responsive behaviour |
| any, text at 200 % | as its width | the text doubles but the index row's vertical padding and the cookie notice's offset and padding keep their normal-size pixels (`min(rem, px)`), so at 1280×800 a doubled row (≈ 244 px) sits well inside the band between the wrapped header (≈ 207 px) and the open notice (≈ 174 px with its gap) | brief: Interactions (Keyboard order, twice the text size); decided: under the verifier's Linux metrics a 300 px row had about 7 px to spare and overlapped the notice |

## Motion

| Moment | Duration / easing | Properties | Reduced motion | Source |
|---|---|---|---|---|
| hover / focus colour | 300 ms `cubic-bezier(.25,.1,.25,1)` | color, background-color, border-color, opacity | at once | brief: Motion (≈⅓ s) |
| heading arrival | 600 ms `cubic-bezier(.16,1,.3,1)`, lines 100 ms apart | WAAPI `transform` of each line inside an overflow mask | not split | brief: Motion |
| index row lift | 200 ms `cubic-bezier(.2,0,0,1)` | row `translateY(-4px)`, title quiet → ink, on hover and focus | no lift; title colour at once | brief: Motion |
| chapter panel | 600 ms `cubic-bezier(.16,1,.3,1)` (the entering timing: quick start, glide to a stop), stepped each animation frame (`site.js` `movePanel`) | panel `height` from its old to its new height, pushing later chapters | none | brief: Motion |
| cookie notice | 600 ms drive | WAAPI `translateY(120%)` ↔ 0; inert and `aria-hidden` from the moment closing starts | appears / leaves at once | brief: Motion |
| desk row move | 200 ms snap | FLIP `transform` of moved rows | none | brief: Motion |
| promise-line hold | on scroll, linear | the line with its sub-line and two links, `.hero-copy`, a sheet of the page ground edged above and below by a hairline, above the strip, `translateY(0.75 × scrollY)` over scroll 0 → 100vh at every width, so the line moves a quarter as far as the strip and the rows pass beneath it; the same rate carries on until the strip has wholly passed, where the line settles below it (`site.js` `setUpPromiseHold`); the room the line travels into carries the hero's 7 % contour texture and closes with a hairline, so a still frame reads it as a section of paper | in flow, live | brief: Motion (the strip behind the line, the line a quarter as far); decided: the ground sheet keeps the line readable over the rows, and on a screen too short to show a whole row below the sheet, a measured gap is added above the strip so each row is read before it passes; a keyboard stop in the hero returns the line to its flow place, so a focused row is never beneath it |
| year marker | IntersectionObserver, middle of window | sticky side span text | hidden; per-chapter spans printed | brief: Motion |

## States

| Surface | State | Treatment | Source |
|---|---|---|---|
| enquiry form | rest / in flight / success / refused / outage | as Journey 2 | brief: Feedback states |
| index | empty | an open drawer of staggered index cards with a pull (1.5 px `currentColor` stroke), the sentence balanced in at most 30ch, "No reference is cleared for publication at the moment", lime "Leave an enquiry" | brief: Feedback states |
| detail | preview | deep band "Preview: the reference is not published", no enquiry link | brief: Feedback states |
| detail (fi) | untranslated | "Tämä tarina on vielä kääntämättä" with an ink rule beside it, above the English text | brief: Feedback states |
| any | unknown address | 404, wordmark, "That page is not here", links home and to the index | brief: Business rules |
| any | Postgres down | API `503 {"message":"The reference desk is unavailable right now"}`; page 503 with that sentence | brief: Server boundary |
| copy button | used / refused | "Copied to the clipboard" / "Copy not available" for 2 s from the latest activation | brief: Interactions |
| desk | each action | "Saving…" / results / refusals in `status "Desk messages"`; unreachable: "The desk cannot be reached. Your change was not saved." | brief: Feedback states |

## Breakpoints

| Width | Rule | Source |
|---|---|---|
| ≥ 1100 | wide | brief: Responsive behaviour |
| 640–1099 | inset 40, gap 24, stacked hero/contact, panels and cards two across | brief: Responsive behaviour |
| ≤ 639 | inset 20, gap 16, Menu, single column, display sizes step down; the header wraps and every icon stays | brief: Responsive behaviour |

## Media

| File | Origin | Licence | Source |
|---|---|---|---|
| story-harbour / -dairy / -papermill / -raildepot (640, 1280 jpg) | Wikimedia Commons (Syced; Sergeev Pavel; Kaipola 1956) and Pexels (ravencrow BI) | CC0-1.0, public domain, Pexels License | brief: Server boundary (licence permits reuse) |
| portrait-*.svg | drawn for this app | original | decided: invented people get drawn portraits, not photos of real people |
| social-preview.png | rendered for this app | original | brief: Browser support (social preview image) |
| fonts | Source Serif 4 300, Inter 500 (Fontsource) | SIL Open Font License 1.1 | brief: Server boundary |

## Seed as shipped

Exactly the brief's seed: programmes, three accounts (salted PBKDF2-SHA256, 240 000 rounds), six
references with their figures, the Finnish title and body of `harbour-crane-retrofit`, the Aspen Mills
quote, three notes (one draft), two open enquiries at 2026-10-01 09:00 and 2026-10-02 10:00 Helsinki time, one
`service_clock` row with offset 0.
brief: Seed data

## Judged-criteria mapping

| Criterion | Satisfied by |
|---|---|
| B1 home on the ground | hero, strip, panels without fill or shadow; hairlines |
| B2 contact | `.contact` grid, form column on the ground |
| B3 directory cards | `.card`: portrait on top, deep body, ground text |
| B4, B15 palette | ground / ink |
| B5 lime CTAs | `.cta` reads `--lime` (header Enquire, Start an enquiry, Ask about this reference, empty-state link) |
| B6, B7, S1 type | `@font-face` Source Serif 4 300 and Inter 500 from `/static/fonts` |
| B8 rows | `.index-rows > li` 1px hairline, no shadow, radius or fill |
| B9 narrow rows | inset 20 px; `overflow-wrap` breaks only as a last resort |
| B10, S3 shared parts | `_parts.html` macros and `.chapter`, `.pull-quote`, `.figures` on both routes |
| B11, B13, B14 desk | sans throughout, bordered fields, editor beside the list when wide |
| B12 field errors | `--brick` |
| S2 desk list | `desk.js` `refresh` → `showReferences` / `showTotals`; state word from the API's `state` |
| S4 index rows | `pages.references` → `library.live_rows` |
| Q1 | names from the brief across `library.py`, `api.py` |
| Q2 | `clock.now`, `library.LIVE`, `reference_state`, `settle_run`, `slugify`, `require_steward`, `edit_reference` (the void), `EDITABLE_FIELDS` |
| Q3 | `api.desk_account` → `library.session_account` |
| Q4 | `api.Refusal.response` plus the app-level handlers in `northfall/__init__.py` |
| Q5 | `copy.py`; `desk.js` `focusTargets` |

## Disputes

None open. The bundle copied on 2026-11-02 has `outages = []` (`requirements.toml` line 57) and drives outages through a
relay inside `test_app.py` (`_scratch(relayed=True)`), so the earlier :4174 health deadlock is gone. Its `test_seed_first_boot`
(lines 584-585) lists the accounts in true sorted order. The previous iteration's deployment failure came from the older bundle.
