# TRUTH: Relayo marketing site and partner program

Ground truth of the golden in `app/` (Werkzeug + Jinja2 on gunicorn, pg8000 to PostgreSQL, Keycloak over
OIDC + admin REST, SMTP to Mailpit). Every value says where it came from: `brief: <section>` (verbatim from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Ideal flow per journey

### 1. Read the story (`/`)
- Start: first visit, no `relayo_cookie_choice` cookie, so the non-modal `dialog "Cookie preferences"` is
  rendered open at the lower edge (brief: Cookie preferences; decided: server renders it open so it shows at
  first paint without stealing focus).
- The hero shows h1 `Every meeting, captured and ready to act on.`, the line `Relayo joins your calls, takes
  the notes and hands your team the next steps.`, pills `Start for free` / `Book a demo` (outbound
  placeholders) and the inline-SVG orb on the right (brief: Public screens and controls; Visual design).
- Scrolling the 300vh `region "Before, during and after"` (≥768, motion allowed) holds the step list and panels;
  thirds of `height − viewport` move `aria-current="step"` Before → During → After and back; the blue line fills
  with the scroll (brief: Signature interaction). Under 768 or reduced motion the panels stack and the panel
  crossing the viewport middle carries the marker.
- Phone: a ≥50px, mostly horizontal touch swipe on `region "Use cases"` moves one slide; `status "Current use
  case"` reads `Use case 2 of 5: Education Agent`; Previous is `aria-disabled` on slide 1; vertical swipes scroll
  the page (`touch-action: pan-y`); mouse drags do nothing; non-current slides are `inert` (brief: Home
  carousel). `Explore the Education Agent` opens `/education-agent`; `link "Relayo home"` returns to `/`.
- End: home readable, nothing recorded in any provider.

### 2. Browse integrations (`/integrations`)
- Choosing CRM then Calendar: each choice sets `aria-current="true"` at once, pushes `?category=…`, sets
  `Results` to `Loading…`, fetches `/api/integrations?category=…`; a request number drops any superseded answer
  (brief: The latest choice wins). Calendar shows `3 integrations`.
- Forced colours: the current link keeps a 2px border (others 1px); focus rings are 3px outlines at 2px offset
  (brief: Current marker and focus ring).
- Card link `/integration/datebook-calendar?from=%2Fintegrations%3Fcategory%3DCalendar`; `Back to integrations`
  follows `from` only when it is `/integrations` or starts with `/integrations?` (`pages.return_address`), and
  stores the slug in session storage so the list focuses that card below the header (brief: Return to the list).
- A failed or 5xx list request shows `This list is unavailable right now. Try again in a minute.` with the
  address and marker on the chosen entry (brief: Feedback states).

### 3. Browse press and blog (`/press`, `/blog`)
- `/press?category=News`: Load more sets both paging buttons `aria-disabled="true"` while loading, so a double
  press pushes one entry `?category=News&page=2`; focus goes to the first headline. Reload renders items 11–20
  server-side; Back returns to page 1 with Previous disabled (brief: Press paging).
- `page=1`, `0`, `-1`, `abc`, `1.5` render page 1 and `replaceState` without `page`; beyond the last page shows
  `No press items on this page.` with `Show all press` and no paging (brief: Press paging).
- Scheduled rows (`scheduled-2099-launch`, `Relayo at the 2099 partner summit`) never appear: the publication
  predicates in `public.PUBLIC` use the PostgreSQL clock everywhere (brief: Business rules 13).
- Lists answer a strong `ETag` (SHA-256 of the body) with `Cache-Control: no-cache` and 304 on a weakly matching
  `If-None-Match` (brief: Conditional reads).

### 4. Apply to partner (`/partner-program`)
- Thirteen fields in four sets (About you, Your company, Your market, Your partnership), each limited field with
  `Up to N characters`, the goals counter `n / 2000` using the server's White_Space list (brief: Partner form).
- A refused submit: `alert` with `Please correct the fields below.` and one link per failing field named
  `<field>: <message>`; focus to the first failing field; links focus without changing the address
  (brief: Interactions 6). Over-long and control-character text is kept.
- The draft (13 values + Idempotency-Key) lives in `sessionStorage["relayo-partner-draft"]`; the key is reused
  until a value changes (brief: Interactions 3–4). A dropped connection shows `We couldn't reach Relayo. Your
  answers are still here.` with `Try again`; the retry after reload replays the stored 201.
- End state: one `partner_applications` row `pending`, one `outbound_emails` `receipt` row in the same
  transaction, one Mailpit message `We received your Relayo partner application` to the work email with the
  display name `<first_name> <last_name>`; the region `Application received` thanks the stored company name.

### 5. Review and decide (`/review`)
- Sign-in posts `/api/auth/login`; the token is kept in `sessionStorage["relayo-staff-token"]`. The queue loads
  `?status=pending&sort=submitted`; the toolbar holds `navigation "Queue order"`, `navigation "Application
  status"`, `status "Queue counts"` (`p pending, a approved, r rejected`) and `table "Partner applications"`
  with Reply due cells `YYYY-MM-DD HH:MM Berlin` (brief: Public screens and controls).
- Approve opens `dialog "Approve application"` (note hint `Up to 1000 characters. Never sent to the
  applicant.`); Confirm → `Saving decision…` → `Application approved. The applicant will be emailed.`, the queue
  and the open details reload, details show `Outcome email: Queued|Sent`, focus moves to the caption.
- A 403 on any review request removes the queue, counts, navs, details and dialog at once and focuses
  `Your account does not have access to partner applications.`; Sign out stays (brief: Access withdrawn).
- Sign out → `Signing out…` (button `aria-disabled`) → ends only that Keycloak session
  (`DELETE /admin/realms/{realm}/sessions/{sid}`) → `You have signed out.`, focus on Email.

### 6. Refused analyst
- Five failures lock the email key for `LOGIN_FAILURE_WINDOW_SECONDS`; the page counts the 429 `Retry-After`
  down on its own clock per email key, `Sign in` `aria-disabled`; at zero `You can sign in again.`
  (brief: Sign-in wait). The analyst's first queue request answers 403 → no-access state.

### 7. Choose cookies
- `Cookies Settings` reveals Strictly Necessary (checked, disabled), Performance, Functional, Targeting and
  `Confirm My Choices`; any choice writes `relayo_cookie_choice=performance.0-functional.0-targeting.0` (first-party,
  one year) and closes the panel. Footer `Cookie preferences` reopens it with the saved choice; Escape then
  closes it and returns focus (brief: Cookie preferences; decided: cookie name and format).

## Palette

| Role | Hex | Used for | Source |
|---|---|---|---|
| ground | `#ffffff` | page field | brief: Visual design |
| panel | `#f4f6fa` | bands, panels, footer | brief: Visual design (very pale cool grey) |
| hairline | `#dfe4ec` | rules, card edges | brief: Visual design |
| ink | `#0c1426` | headings | brief: Visual design (near-black cool ink) |
| text | `#2c3546` | body | brief: Visual design |
| muted | `#5a6578` | hints, dates, reply-due (5.9:1) | brief: Visual design |
| control-edge | `#6b7487` | field borders (4.7:1) | decided: AA control edges |
| accent | `#1d4ed8` | primary pills, links, current filter/status/order, progress line, dots, focus | brief: Visual design; decided: hue 224° |
| accent-strong | `#1a3fb0` | hover / press | brief: Motion (buttons darken) |
| sky | `#bfdcff` | orb mid stop | brief: Visual design (orb) |
| success | `#2e6b3c` | Approved badge, received panel edge | brief: Visual design |
| danger | `#a3322b` | field errors only (field message, invalid group legend and checkbox edges) | brief: Visual design |
| alert edge | `#0c1426` on `#f4f6fa` | error summary and outage / duplicate / no-access alerts: ink 4px leading edge on panel grey, summary links in accent | decided: brick red is reserved for field errors, so alerts use ink and words |

## Type, space and layout

| Token | Value | Source |
|---|---|---|
| display | Outfit 700, −0.02em, `clamp(2rem, 1.2rem + 3.4vw, 3.5rem)` (56px at 1280, 32px at 375) | brief: Type |
| section heading | Outfit 700, up to 2rem | brief: Type (≈2× body) |
| card title | Outfit 600, 1.25rem | brief: Type |
| body | Source Sans 3 400, 16px / 1.6; article measure 68ch | brief: Type |
| radius | media 20px, panels 24px, fields 10px, pills 999px | brief: Shapes |
| targets | 44×44 minimum | brief: Targets |

| Viewport | Layout | Source |
|---|---|---|
| 1280×800 | one-row header, Agents menu below it; two-part hero; held narrative; 3-across grids; form sets in two columns with the summary above; table with details beside | brief: Screens and layout |
| < 1024 | Menu button panel; 2-across grids; hero stacked with orb behind (washed copy); form one column; details below the table | brief: Screens and layout |
| < 768 | narrative stacked; reviewer table as stacked cards with every value and both buttons; cookie panel full-width sheet | brief: Screens and layout; decided: 768 card switch |
| < 600 / 375 | 1-across grids, one column everywhere | brief: Screens and layout |

## Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| card lift (−4px) + shadow | hover, focus-within | 200ms | `cubic-bezier(.215,.61,.355,1)` | shadow only | brief: Cards |
| button darken / press | hover / active | 100ms | `cubic-bezier(.2,.8,.2,1)` | none | brief: Buttons |
| narrative panel fade + rise | step change | 330ms | ease-out | stacked, no fade | brief: Signature interaction |
| carousel glide | button, key, swipe | 400ms | `cubic-bezier(.65,0,.35,1)` | instant | brief: Carousel |
| list cross-fade | list render | 200ms | ease-out (WAAPI) | none | brief: Lists |
| dialogs, Agents menu | open / close | 200ms | ease-out (`@starting-style`) | none | brief: Dialogs and menus |
| cookie panel slide-up | open | 250ms | ease-out | none | brief: Cookie panel |
| headline + orb entry | page entry | 700ms | ease-out | none | brief: Page entry |
| tools strip | continuous | 40s linear loop, paused on hover/focus/button | — | static, wrapped, no button | brief: Named loop |
| withdrawn access | 403 | 0ms | — | — | brief: Withdrawn access |

## States per async action

| Action | Pending | Success | Errors | Source |
|---|---|---|---|---|
| submit application | `Submitting your application…` (button + Form status) | Application received region | 422 summary + inline; 409 duplicate alert; outage alert + Try again; 409 in progress → retry ×3 after 2s | brief: Feedback states |
| list choice / page | `Results: Loading…`, paging `aria-disabled` | count | list outage alert | brief: Feedback states |
| sign in | `Signing in…` | queue | 401, 429 countdown, 503 alerts | brief: Feedback states |
| decision | `Saving decision…` | approved / rejected copy | 409 already decided, 422 beside note, 403 withdraw, 503 alert | brief: Feedback states |
| sign out | `Signing out…` in `status "Review status"`, `Sign out` `aria-disabled="true"` (a second press sends nothing) | `You have signed out.` | 503 alert `Sign-out is unavailable right now. Try again in a minute.` (pending copy cleared, still signed in) | brief: Feedback states (every async action shows and announces its pending state); decided: pending copy `Signing out…` mirrors the brief's `Signing in…` |

## Backend truths

- Check order per brief Business rules 1, implemented in `api.py` handlers (405 with exact `Allow` first, then
  413/415, 401, 403, 404, 400 invalid_json, key format, stored answers, validation, conflicts).
- One applicant: unique index on `(work_email COLLATE "C")`, `INSERT … ON CONFLICT DO NOTHING` (brief: rule 8).
- Idempotency: one `INSERT … ON CONFLICT (key) DO UPDATE … WHERE expires_at <= clock_timestamp()` decides the
  processor; body equality via a canonical form (member order ignored, numbers by value, true ≠ 1); stored
  answers 201 / 409 duplicate / 422 replayed with `Idempotent-Replayed: true` (brief: rule 9).
- Decision: `UPDATE … WHERE id = :id AND status = 'pending' RETURNING *` + outbound row in one transaction.
- Sign-in limit: `pg_advisory_xact_lock(hashtextextended(email_key))`, count in window, insert failure.
- Delivery: `FOR UPDATE OF e SKIP LOCKED` per row; backoff `min(2^attempts, 30)` s; Message-ID
  `<outbound-email-<id>@relayo.example>`; the To display name is one quoted phrase holding RFC 2047 base64 encoded
  words (≤75 chars, folded), one encoding for every name (brief: Mailpit round trip; decided: the quoted phrase keeps
  text that looks like an encoded word, e.g. `=?utf-8?q?Admin?=`, literal: Python's standard `email` parser and
  Mailpit both return the exact name, measured for all three brief examples).
- Disabled accounts: decided: Keycloak 26 revives tokens on re-enable, so a token found inactive while its user is
  disabled records its `sid` in `ended_sessions`, answered 401 from then on (brief: rule 12).
- Reply due: `reply_due.py` per brief rule 14 (worked examples verified: 2026-10-23T14:00Z → 2026-10-27T15:00Z,
  2026-12-23T14:00Z → 2026-12-29T14:00Z).

## Seed

Accounts `reviewer@example.com` (role `partner-reviewer`) and `analyst@example.com`, password
`deku-demo-pw-2026` (brief: Seed data). 32 integrations (30 published; unpublished `ledgerline-crm`,
`coldstore-archive`), 28 articles (25 public; `draft-q4-roadmap`, `unpublished-pricing-notes` unpublished;
`scheduled-2099-launch` 2099), 28 press items (21 News + 4 Press Releases public; 1+1 unpublished; 2099
summit), 6 jobs (4 open), 10 resource cards (brief: Seed data). Invented names and copy: decided.

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Outfit, Source Sans 3 woff2 | OFL-1.1 | Fontsource 5.2.5 |
| agent posters, careers band, favicon | original | `selftest/make_art.py` |
| integration icons, article covers | original | drawn per row by `relayo/media.py` |
| orb, narrative and empty-state drawings, icons | original | inline SVG |
