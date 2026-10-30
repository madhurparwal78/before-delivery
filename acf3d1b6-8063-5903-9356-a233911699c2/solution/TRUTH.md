# TRUTH — Kinora Video Studio

The golden's ground truth. The source bundle shipped no reference app (its `solve.sh` was a NO-SOLUTION stub and its
DESIGN.md an empty template), so every value here comes from the brief (`brief: <section>`), the capture ledger of
the original site (`decided: ledger §n …`) or a decision that follows the brief's intent (`decided: <why>`). The brief
is the authority; a value here that contradicts it is a defect.

## Ideal flow of every journey

### 1. Visitor to first generation (DP-21, DP-24, DP-31, DP-32, DP-33, DP-35)

1. `/pricing` first HTML carries every plan card. Individual tab selected, `switch "Yearly billing"` checked:
   Standard reads `$12` beside a struck `$15` (`<s>`) and "Billed annually. Save $36/year.". `brief: Public site, Content`.
2. Flip the switch: the price block cross-fades (opacity 0 → 1 over 200 ms) to `$15` alone; flip back to `$12`.
   `brief: Motion and effects`; `decided: ledger §5.3 opacity 0.2 s`.
3. `Start Free` → `/signup`. Name "Lena Hart", a new email, a 10+ character password → `POST /api/auth/signup` 201.
   One transaction: user (owner), workspace "Lena Hart's workspace" on `free`, a `plan` entry +125
   (`balance_after` 125), project "My first project". Token in an HTTP-only cookie and memory → `/studio`.
   `brief: Sign up and sign in, Business rules`.
4. Sidebar: wordmark + "Creative", `New generation`, Home, Projects, Credits, Team, "Lena Hart", workspace, "Free",
   "125 credits", `Log out`. Composer defaults Vela 4.5 / 5 seconds / 16:9 / My first project; "This will use 60
   credits". `brief: Studio`.
5. Prompt "A paper lantern rising over a quiet harbour at night", `10 seconds` → "This will use 120 credits".
   `Generate`: button disabled with a linear spinner, one fresh `Idempotency-Key` per press. Server, in one transaction
   (`SELECT … FOR UPDATE` on the workspace row): cost = 12 × 10, balance ≥ cost, running < parallel limit, insert
   generation `queued`, insert `charge` −120 (`balance_after` 5); the balance is the sum of the entries, so it is 5 at
   once. 201. `brief: Business rules`;
   `decided: a workspace row lock serialises concurrent starts`.
6. The new card lands at the top of Recent generations with a springy overshoot (scale 0.96 → 1 on
   `cubic-bezier(0.34, 1.56, 0.64, 1)`, 400 ms), reads Queued; the sidebar reads "5 credits" from the response.
   `brief: Motion and effects`; `decided: ledger §5.2 springy curve`.
7. Server scheduler (one `setInterval` in the Nest process, 1 s tick): `queued` → `rendering` once 0.5 s have passed
   (so by 1.5 s), `rendering` → `ready` once 12 s have passed since `created_at` (12–13 s, inside 8–30 s), setting `finished_at`, skipping cancelled rows by a conditional
   `UPDATE … WHERE status = 'rendering'`. The page polls `GET /api/generations/{id}` every 2 s while any card is not
   final. `decided: fixed 12 s render sits mid-window`.
8. Ready: the picture (`/api/generations/{id}/output`, `<img alt=prompt>`) fades in over 300 ms. A second Generate for
   30 credits → 402 → alert "Not enough credits. This needs 30 and you have 5.". `brief: Feedback states`.
   Every generation has exactly one output picture; a Vela Image 4 generation of 1 to 4 images is one still SVG
   (count prices it and labels the card "<n> images", never a montage or separate pictures). `brief: Business rules, Output`.

### 2. Cancel and refund (DP-37, DP-38, DP-39)

1. Ines signs in, Vela 4 Turbo, 5 seconds, project Music video → 201, sidebar 595 → 565.
2. Project page shows the card Rendering with its filling bar and Cancel. `POST /api/generations/{id}/cancel`: one
   transaction, `UPDATE generations SET status='cancelled', finished_at=now() WHERE id=$1 AND status IN
   ('queued','rendering') RETURNING *`; zero rows → 409; one row → `refund` +30 entry, balance +30. A partial unique
   index `credit_entries(generation_id) WHERE kind='refund'` backs it. `brief: Business rules`;
   `decided: conditional update plus index make a double refund impossible`.
3. Toast (`role=status`) "Cancelled. 30 credits returned." rises 8 px while fading in (200 ms), leaves after 4 s.
   Sidebar back to 595. `/studio/credits`: newest rows "Refund +30", "Generation -30". `brief: Journeys`.

### 3. Team invitation and join (DP-40 to DP-44)

1. Mara → `/studio/team`: "2 of 9 seats used", members Mara (Owner), Theo (Member), `Invite teammate`.
2. Dialog "Invite teammate" → `jo.ellis@example.com` → `POST /api/team/invitations` 201: invitation row with a 32-byte
   base64url token; then nodemailer sends one message from `studio@example.com` to that one address, subject
   "Mara Quinn invited you to Northlight Studio on Kinora", body with `<APP_PUBLIC_URL>/invite/<token>`. A send failure
   is logged and the 201 stands. `brief: Services`.
3. `/invite/<token>` (signed out): "Join Northlight Studio on Kinora", fixed email, Name, Password, `Join team` →
   `POST /api/invitations/<token>`: one transaction locking the invitation (`status='pending'`) and the workspace:
   member user, invitation `accepted`, `seat` +6,900 entry, balance +6,900. 201 → full page "You're in. Welcome to
   Northlight Studio." → `Open the studio`. Balance reads 20,564 for everyone. `brief: Journeys, Business rules`.
4. Theo (member) sees Jo on the team page with no `Invite teammate`, no `Revoke`, no `Remove`; owner-only endpoints
   check the role on the session row behind the bearer token and answer 403. `brief: Problem and users`.
5. Remove member: dialog "Remove member" → `DELETE /api/team/members/{id}` sets `removed_at` and empties their `session_hashes`;
   their token and login answer 401; no entry is written. Self removal → 409 `cannot_remove_self`.

### 4. Enterprise enquiry (DP-45, DP-46, DP-47)

1. `/enterprise-contact`: media panel left (drawn bands), form right. Empty `Submit` → client validation mirrors the
   server: every required field gets `aria-invalid="true"` and a red message tied by `aria-describedby`, and a
   `role=alert` summary announces them; values stay. `brief: Enquiry forms`.
2. Filled for "Harbour & Pine" → `POST /api/enquiries` 201: row stored, then two messages: to `sales@example.com`
   "New enterprise enquiry from Harbour & Pine" (name, email, company, size, industry, products, message) and to the
   requester "We received your enquiry" ("…within two business days"). Page replaced by "Thanks, we will be in touch
   within two business days." with `Back to home`. `brief: Services`.
3. Mail down (SMTP refused): both stored, both 201. `brief: Services item 4`.

### 5. Public chrome and pages (DP-02, DP-03, DP-19, DP-20)

Pages are rendered by the server on each request with `preact-render-to-string` (so `/invite/<token>` can name its
workspace) and hydrated by `preact-iso`; Nest serves them, the JSON API under `/api`, and a 404 page (public chrome, "Page not found", "We could not find that
page.", `Back to home`) for any other path. The band scrolls away; the header is `position: sticky; top: 0` on a
frosted near-white (`rgba(255,255,255,0.8)` + `backdrop-filter: blur(8px)`). Menus are disclosure buttons with
`aria-expanded`; Escape, outside click or another menu closes them; focus returns to the opener.
`brief: Public site`; `decided: ledger §6 backdrop-filter blur(8px)`.

## Palette

| Role | Value | Used for | Source |
|---|---|---|---|
| ground | #ffffff | page ground, cards, dialogs | brief: Visual design; decided: ledger §2 |
| panel | #f6f6f6 | panels, secondary (near-white) buttons | brief: Visual design; decided: ledger §2 |
| studio ground | #f7f8fa | studio work area | brief: Visual design; decided: near-white cool grey |
| current row | #eef1f5 | current sidebar row | brief: Visual design; decided: ledger §2 |
| ink | #0c0c0c | headings, near-black buttons (hover #000000) | brief: Visual design; decided: ledger §2 |
| body | #404040 | body text | brief: Visual design; decided: ledger §2 |
| muted | #666e7a | captions, muted text | brief: Visual design; decided: ledger §2, 5.1:1 on white |
| hairline | #e5e7eb | borders, dividers | brief: Visual design; decided: ledger §2 most-used |
| accent | #4a2af2 (hover #3a1dd6) | Generate, Sign up, form links, focus ring, New generation plus circle | brief: Visual design; decided: ledger §2 #2b22fa sits at hue 242° (reads blue); hue 250° keeps it blue-violet, 7.2:1 with white |
| indigo soft | #e7e5ff | plan badges, template art highlights | brief: Visual design; decided: light soft indigo |
| orange soft | #ffe8d9 | plan badges, template art highlights | brief: Visual design; decided: light soft orange |
| error | #d9262c | every refusal and field message | brief: Visual design; decided: mid vivid red, 4.9:1 on white |
| success | #1a7f45 | success notes (Prompt copied) | brief: Visual design; decided: mid green, 5.0:1 on white (ledger #1f8a4c is only 4.4:1) |
| band | linear-gradient(90deg, #1b2a8f, #6a3df0) | announcement band, white text | brief: Visual design |
| footer | #0c0c0c with #ffffff and #9ca3af text | footer | brief: Visual design; decided: ledger §2 |
| research band | #0c0c0c | home Kinora Research band | brief: Public site |

Contrast: ink on white 19.6:1, body on white 10.4:1, muted on white 5.1:1, white on accent 7.2:1, #9ca3af on footer
7.4:1. `brief: Visual design (WCAG 2.2 AA)`.

## Type

| Token | Family | Weight | Size / line height | Used for | Source |
|---|---|---|---|---|---|
| display | Inter (`@fontsource/inter`), system-ui, sans-serif | 500 | clamp(2.75rem, 6vw, 4.5rem) / 1.05, letter-spacing −0.03em | level-one headings | brief: Visual design; decided: large and tight |
| heading | Inter | 500 | 1.75–2.25rem / 1.15, −0.02em | section headings | decided: step below display |
| body | Inter | 400 | 1rem / 1.5 | text | brief: Visual design; decided: ledger §4 16/24 |
| label | Inter | 500 | 0.8125–0.875rem / 1.3 | studio labels, captions | brief: Visual design; decided: ledger §4 13–14 px |
| figure | JetBrains Mono (`@fontsource/jetbrains-mono`), ui-monospace, monospace | 500 | inherits | balance, costs, per-second prices, history amounts | brief: Visual design |

No `text-transform: uppercase` on headings. `brief: Visual design`.

## Layout per viewport

| Width | Public site | Studio | Source |
|---|---|---|---|
| < 768 | header: wordmark + `Menu` (drawer, `role=dialog`); plan cards 1 column; enquiry panel above form; footer columns stacked; tab rows scroll inside themselves | sidebar becomes a left drawer behind `Menu`; composer full width; project and template cards 1–2 columns | brief: Screens and layout |
| 768–1199 | Menu drawer below 1024 (four menus and three buttons need ~1000 px), menus in the header from 1024; plan cards 2 across; enquiry panel and form side by side | sidebar 240 px; cards 2 across | decided: ledger §7 tablet captures, header width budget |
| ≥ 1200 | content max 1200 px with side gutters; plan cards 4 across | sidebar 240 px fixed; composer max 760 px centred in the work area; cards 3 across | brief: Visual design (prompt box in the middle); decided: ledger §6 1200 px gutter |

Touch targets ≥ 24 × 24 px (buttons 40 px tall). `brief: Visual design`.

## Shape and depth

| Token | Value | Source |
|---|---|---|
| button radius | 8px; pills 9999px | brief: Visual design; decided: ledger §6 |
| field radius | 6px | decided: ledger §6 |
| card radius | 12px | decided: ledger §6 |
| composer / promo / hero frame radius | 24px | brief: generously rounded |
| card shadow | 0 1px 2px rgba(12,12,12,.06), 0 4px 16px rgba(12,12,12,.06) | brief: faint shadow |
| focus ring | 2px solid accent, offset 2px | brief: Visual design |

## Motion table

| What | Duration | Curve | Reduced motion | Source |
|---|---|---|---|---|
| link and button colour changes | 150 ms | cubic-bezier(0.4, 0, 0.2, 1) | none | brief: Motion; decided: ledger §5.3 |
| header menus, information tips fade in | 150 ms | same | instant | brief: Motion; decided: ledger §5.3 |
| dialog soft zoom: scale 0.96 → 1, opacity 0 → 1; backdrop rgba(12,12,12,.4) fades in | 200 ms | cubic-bezier(0, 0, 0.2, 1) | instant | brief: Motion |
| mobile drawer translateX(−100%) → 0 over a fading overlay | 250 ms | cubic-bezier(0, 0, 0.2, 1) | instant | brief: Motion |
| toast / popover translateY(8px) → 0 with fade in; toast leaves after 4 s | 200 ms | same | appears, no rise | brief: Motion |
| project and template card lift translateY(−2px) and deeper shadow | 300 ms | cubic-bezier(0.22, 1, 0.36, 1) | no lift | brief: Motion (soft, settling, unhurried) |
| home hero picture scale 1.04 → 1 | 2000 ms | cubic-bezier(0, 0, 0.2, 1) | at rest | brief: Motion; decided: ledger §5.3 transform 2 s |
| partner marquee translateX(0 → −50%), infinite, mask-image edge fades | 30 s | linear | static | brief: Motion |
| pricing price cross-fade | 200 ms | cubic-bezier(0.4, 0, 0.2, 1) | swap | brief: Motion |
| spinner rotate 360deg, infinite | 800 ms | linear | static ring; the button keeps its name "Generate", disabled and dimmed | brief: Motion, Accessible names |
| placeholder breathe (opacity 0.6 ↔ 1) and light sweep (translateX −100% → 100%), infinite | 1.6 s / 1.8 s | ease-in-out / linear | static placeholder | brief: Motion |
| progress bar fill from created_at to expected Ready | 12 s | linear | width jumps per poll | brief: Motion; decided: render time |
| new card landing scale 0.96 → 1 | 400 ms | cubic-bezier(0.34, 1.56, 0.64, 1) | none | brief: Motion; decided: ledger §5.2 |
| finished picture fade in | 300 ms | cubic-bezier(0, 0, 0.2, 1) | instant | brief: Motion |

All motion is CSS or `element.animate()`. The hero settle, the partner marquee, the price swap, the dialog zoom, the
drawer slide, both backdrops, the placeholder breathe and sweep and the progress bar run through `element.animate()`
(`src/web/ui/motion.ts`), which is skipped under reduced motion; menus, tips, toasts, the landing card, the finished
picture, the spinner and hover lifts are CSS. One `@media (prefers-reduced-motion: reduce)` block removes every CSS
animation and transition; the drawn video SVGs carry their own reduced-motion block. `decided: WAAPI starts with the
element and is readable frame by frame`. `brief: Motion and effects`.

## States

| State | Treatment | Source |
|---|---|---|
| empty | "No projects yet" + `New project`; "No generations yet. Start one from the composer." + link; new account history shows its one plan row | brief: Feedback states |
| loading | breathing placeholder with sweep and filling bar on non-final cards; spinner in a saving button | brief: Motion |
| error | red message under the field (`aria-describedby`, `aria-invalid`), `role=alert` for refusals; values kept | brief: Feedback states |
| success | toast `role=status` ("Cancelled. <n> credits returned.", "Prompt copied" in green, "Project created.", "Project renamed.", "Invitation sent.", "Invitation revoked.", "Member removed."); full-page confirmations for enquiry and join | brief: Feedback states; decided: every studio action confirms visibly |
| denied | signed-out studio → `/login`; signed-in `/login` or `/signup` → `/studio`; other workspace's project or generation → "That project does not exist." / "That generation does not exist." | brief: Sign up and sign in, Studio |
| unavailable | disabled controls get `aria-disabled`, reduced opacity and a not-allowed cursor plus the spinner or label change, never colour alone | brief: Visual design |

## Breakpoints

| Width | What changes | Source |
|---|---|---|
| 375 | phone: drawers, one-column plan cards, enquiry panel above form | brief: Screens and layout |
| 768 | two-column grids; studio sidebar fixed; header menus return at 1024 | decided: ledger §7 tablet |
| 1200 | four plan cards across; content capped at 1200 px | decided: ledger §6 |
| 1440 | gutters grow, content stays capped | decided: wide screens keep line lengths |

## Data and integrity decisions

| Rule | Mechanism | Source |
|---|---|---|
| charge once, never below zero | workspace row `FOR UPDATE` inside the start transaction; the balance is `SUM(credit_entries.amount)` read under that lock; `CHECK (balance_after >= 0)` and a partial unique index (one `charge` per generation) on `credit_entries` | brief: Data model; decided: no stored balance column to drift |
| idempotency | unique index `generations(workspace_id, idempotency_key)`; on conflict return the existing row with 200 | brief: Data model |
| refund once | conditional status update + partial unique index on refund per generation | brief: Data model |
| seat once | invitation `FOR UPDATE … WHERE status='pending'` in the join transaction; partial unique index (one `seat` per user) | brief: Business rules |
| ledger | `credit_entries` insert-only; `balance_after` written from the locked balance | brief: Data model |
| seed | one transaction under `pg_advisory_xact_lock`, skipped when `owner@example.com` exists; schema `CREATE … IF NOT EXISTS` in the same lock; run on every start | brief: Seed data; decided: several copies may start against one database |
| sessions | no table of their own (the brief's seven tables): `users.session_hashes text[]` holds the SHA-256 of each live 32-byte token, the 20 newest per person; logout removes its hash, removal empties the array | brief: Data model (seven tables), API (logout ends the token, removed member's token answers 401); decided: revocable tokens need server-side state, kept on the users row |

## Media and licences

| Media | Made by | Licence | Source |
|---|---|---|---|
| generation outputs (5 s / 10 s looping video SVG, still image SVG) at 1600×900, 900×1600 or 1200×1200 | `src/shared/picture.ts` from the prompt (mood words pick the palette; a hash of prompt and aspect picks horizon, band curves, glow and shapes) | original | brief: Output |
| hero, product, use-case, template, enquiry, account, empty-state and not-found pictures | the same renderer from fixed phrases | original | brief: Generated pictures |
| icons (chevrons, menu, search, copy, info, home, plus, cross, refresh, folder, coins, people, check) | inline SVG in `src/web/ui/icons.tsx`, 1.5 px strokes in `currentColor` | original | brief: Iconography |
| Inter 400/500/600, JetBrains Mono 500 (latin woff2/woff) | `@fontsource/inter@5.3.0`, `@fontsource/jetbrains-mono@5.3.0`, bundled by Vite | OFL-1.1 | brief: Typography |
| partner wordmarks | invented names set in Inter | original | brief: Iconography |

## Judged criteria mapping

| Criterion | Satisfied by |
|---|---|
| B1 white grounds on `/`, `/pricing`, `/signup` | Palette ground; panel only on controls; no dark panel outside band, research band, footer and drawn pictures |
| B2 Sign up and Generate blue-violet | Palette accent #4a2af2 (hue 250°) with white words on both |
| B3 one vivid red for field messages and the sign-in refusal | Palette error, States error |
| B4 one loaded grotesk sans | Typography display/body/label: Inter 400/500/600 self-hosted, loaded on every page |
| B5 monospace figures | Typography figure: JetBrains Mono 500, tabular-nums, on balance, card cost, history amounts |
| B6 three button skins | ink (Try Kinora), panel (Enterprise Sales, Login, New project), accent (Generate only in the studio) |
| B7 four pills | Try Kinora for free, Contact sales, Log in, New generation at radius 9999px |
| B8 rounded cards on a faint shadow | card radius 12px + elevation card on plan and project cards |
| B9 thin line icons | Media icons: inline SVG, stroke 1.5, `currentColor`, shapes as the brief names them |
| B10 frosted pinned header | depth-and-surface: sticky, rgba(255,255,255,.8), backdrop-filter blur(8px) |
| B11 slim sidebar, centred composer | Breakpoints ≥1200: sidebar 240px; composer max 760px centred in the work area |
| B12 one drawn language | subject-rendering: one renderer for hero, enquiry panel, templates, outputs |
| B13 band gradient deep blue → violet | Palette band |
| B14 near-black footer | Palette footer |
| B15 tab panels in the first HTML | every home and `/product` tab panel is server-rendered with `hidden`; choosing a tab only toggles `hidden` and `aria-selected` (no panel mounts on select) |
| S1–S4, Q1–Q6 | PLAN.md decisions and TRUTH.md Data and integrity |
