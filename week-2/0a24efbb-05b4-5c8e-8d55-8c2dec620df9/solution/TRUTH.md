# TRUTH.md — Rostara Attendance Desk

Ground truth for `app/`. Every value is `brief: <section>` (copied from `instruction.md`) or `decided: <why>`.
Values are read from `app/server.mjs`, `app/src/*.mjs`, `app/app/**/*.jsx`, `app/app/styles.css` and `app/public/desk.js`.

## Boot

1. `NODE_ENV=production node server.mjs` listens on `0.0.0.0:${APP_PUBLIC_PORT}` at once, then retries every 2 s
   (decided: brief asks at least every 5 s) two independent steps: (a) under the advisory lock `rostara.boot`, apply
   `src/schema.sql` (idempotent) and seed once in one transaction; (b) make every seeded account exchange the seeded
   password with the realm, registering missing ones through the realm's self-registration form. brief: Server
   boundary (Starting up, One seeder, Dependency down at boot), Services.
2. `GET /api/health`: 503 `{"status":"starting","schema","seeded","realm"}` until all three hold, then 200
   `{"status":"ok","schema":true,"seeded":true,"realm":true}` for the life of the process. `schema` = the nine
   relations exist; `seeded` = the employer row committed (it commits with every seeded row); `realm` = step (b)
   succeeded. Until postgres has answered once, every call except `/api/health` answers the 500 (API `{"error": "The
   desk could not complete that. Try again."}`, pages the plain 500 page) before any other step; static assets stay
   served (decided: they need no store). brief: API, Server boundary (Dependency down at boot).
3. `seeded_on` = `EMPLOYER_SEEDED_ON` when a real date, else the London date; moved back off the 1st, 30th and 31st
   to the nearest earlier 2nd–29th. Written once. brief: Seed data.
4. Seed: employer 1 `Kestrel Works` `Europe/London`; people 1–16; 87 attendance rows each (offsets 0–89 minus 44/60/75;
   no sign-out at 3/7/12, no sign-in at 18/25/31; odd ids 09:00–18:00, even 10:00–19:00, source `clock`); requests
   1–9 from the brief's table (raised 20:00 on the day, decided 11:00 the next date, cap month = month of offset 29);
   approvals 4, 7, 8, 9 rewrite that day to 09:00/18:00 `regularisation`; nine leave rows; policy v1 (cap 3, lookback
   30, all five types, no note, created by Priya Sahni at 00:00 on `seeded_on`); audit `seq` 1–6 chained from 64 `0`
   characters (subjects request 4, 5, 7, 8, 9 and policy 1); phones `07700 9001{id:02}` and notes `Emergency contact
   held on paper file KW-{id:04}.`; no shared links and no sign-in attempts.
   brief: Seed data.

## Journeys (ideal flow)

1. **Sign in.** Signed-out `GET /requests?state=pending` → 303 `/login?next=%2Frequests%3Fstate%3Dpending`. The form
   posts JSON to `/api/session` from the island; button reads `Signing in`, status `Signing in`. Success: cookie
   `rostara_session` (HttpOnly, SameSite=Lax, Max-Age=`SESSION_MAX_SECONDS`), browser goes to the safe `next` (server
   embeds it only when safe) or `/requests`. Refusal: alert above the form with the API wording, password cleared,
   address kept. Locked: 429 + `Retry-After`. Realm down: 503 wording; `/login` shows it as a notice while the realm
   flag is false. Sign out: `DELETE /api/session`, then `/login` announcing `You are signed out.` The typed address is
   folded (NFKC, then lower case; `src/text.mjs`) before the realm sees it and for the lockout count, so capitals and
   full-width spellings sign in and a Cyrillic look-alike gets the ordinary 401. Every success issues a new
   desk-chosen session and ends the session the request presented (it then answers the ended-session 401).
   brief: Journeys 1, Business rules (Work addresses, Sessions).
2. **Raise.** `Raise a correction` (violet on `/requests`) → `/requests/new`: draft `<tr>` at the head of the queue,
   cells under Day / Correction / Claimed, reason in a `colspan=8` cell beneath. Type starts on `missed_in`
   (decided: the brief lists exactly five options, no placeholder); time cells follow the type; night shift shows
   `Ends the following day.`. Cells checked on blur and on send (`This is required.`, `This needs at least 20
   characters.`, summary `Fields needing attention: {n}.`); the reason box never caps what is typed and its counter
   reads `{graphemes} / 280`, counted by the same `src/text.mjs` the server uses (server: under 20 → 400, over 280 →
   422 with field `reason`; the reason is stored exactly as sent); one `Idempotency-Key` minted per draft; send disabled in
   flight with status `Sending for approval`. 201 → `/requests?<query>` with alert `Correction for {day} is waiting
   for a decision.` and focus on the new row's link. Refusal → draft keeps its values, alert with the rule, the
   refused field marked and focused. Server order and wordings: brief Business rules, Raising.
3. **Decide.** Manager opens a report's row → `/requests/<id>?<query>`: queue left, pane right, focus on
   `Correction for {day}`. Pane: chip, `Raised by …, reporting to …`, three headed evidence blocks, `Reason given`,
   `Note` + `Approve` (violet) / `Reject`, `What happened`. In flight: both buttons disabled, status `Saving
   decision`, nothing repaints. 200 → alert (`Correction approved. The attendance record for {day} now reads the
   claimed times.` / `Correction rejected.`), the row and pane redrawn from the server (row wash transitions, chip
   cross-fades), counts re-read, focus on the pane heading. 409 → same redraw with the 409 wording. Other refusals →
   inline alert beside the pair (with `Sign in again` on 401), note kept. Server: one transaction, `FOR UPDATE` on
   the request and a per-raiser advisory lock (`src/requests.mjs` `decide`); the audit entry joins the hash chain
   (`src/audit.mjs` `appendAudit`, one append at a time under an advisory lock). People operations reading a request
   also sees `Contact on file` (brand wash) with `Phone {phone}` and the private note on its own line, after the
   raised-by line; no other reader's answer, page or script carries either. brief: Journeys 3, Business rules.
4. **Withdraw.** Raiser's pending request shows `Withdraw`; status `Withdrawing request`; 200 → `Request withdrawn.
   That day is free to claim again.`; 409 → winner's state. brief: Journeys 4.
5. **Policy.** `/policy` (admin): fields grouped, self-approval switch off and disabled with its help line. `Save new
   version` (violet) opens `<dialog>` `Save this policy?` naming `version + 1`; `Save` sends `PUT /api/policy` with
   `If-Match: "{version}"`, status `Saving policy`; dialog closes on the answer. 201 → alert `Policy version {n} is
   now in force.`, footer/history/trail redrawn, focus on `Save new version`. 412 → alert, callout `Version {n} was
   saved by {name}. Your changes are still in the form.`, form adopts `n`. 400 with field → `aria-invalid` +
   `aria-describedby` on the field (the group and each checkbox for `enabled_types`), focus there. The `Whole trail`
   heading carries `Download trail` (outlined, download glyph), an ordinary link to `/api/trail.csv`, which answers the
   file in the body (CR LF lines, no BOM, cells neutralised then quoted). `GET /api/trail/verify` recomputes each
   stored entry. brief: Journeys 5, Business rules (Trail chain, Trail export).
6. **Find.** Chips (radiogroup, roving tabindex, arrows/Home/End move, Space/Enter apply), `Search reasons`, `Sort`,
   `Filters` sheet (`<dialog>`, focus trap, Escape/`Close` return focus). Every change `location.replace`s the
   canonical query (`src/queue-query.mjs`, shared with the browser). Row links push `/requests/<id>?<query>`; `Desk`
   links to `/requests?<query>`; returning focuses the row's `Open request {id}` link. brief: Journeys 6, Interactions.
7. **Month.** `/calendar` (manager, admin): `Previous month` / `Next month`, table captioned `{Month} {year}`,
   Monday-first weeks, out-of-month cells `{d} {Mon}`, marks `{label}: {n}` beside their glyph, legend `What the
   marks mean`, `Person` + `Show` (violet). Narrowed to one person, `Share this month` (outlined, link glyph) sits
   beside `Show`; status `Creating shared link`; 201 → a read-only `Shared link` textarea
   (`{APP_PUBLIC_URL}/share/{token}`, wraps, text selected and focused) and `Revoke link` (outlined) appear beneath,
   alert `Shared link created. It works until {expires}. Any earlier link for this month no longer works.`;
   `Revoke link` → status `Revoking link`, 204 → field leaves, alert `Shared link revoked.`, focus back on `Share this
   month`; a 409 also clears the field. `/share/<token>` (no session read, no script, `Referrer-Policy: no-referrer`):
   banner with the brand only, h1 `{name}, {Month} {year}`, the same grid and legend, footer `Rostara attendance desk.
   Shared read-only.`; 410 page `This shared month is no longer available` / `Ask the person who shared it for a new
   link.`; unknown token → the signed-out 404 page. brief: Journeys 7, Business rules (Shared links).

## Palette

| Role | Value | Basis |
|---|---|---|
| ground | `#fcfcfd` | brief: near-white neutral |
| ink / secondary / tertiary | `#17171c` / `#45454d` / `#5f5f68` | brief: near-black, deep neutral, declared third tone |
| hairline / band | `#e2e2e7` / `#f3f3f6` | brief |
| top bar / its text | `#10151f` / `#f7f7fa` | brief: near-black cool neutral, near-white text |
| violet / pressed | `#6d28d9` / `#5b21b6` | brief: mid, vivid violet, darkens on press |
| indigo | `#3f3c84` (brand plate, selected row edge) | brief |
| pale violet | `#e7defb` (pane and login card top edge, trail rule) | brief: decoration only |
| brand wash | `#f4eeff` (selected row, info callout, `Contact on file` block, initials badge) | brief |
| cyan | `#0e7490` (trail, timestamps) | brief |
| chips | pending `#ffc266`/ink/edge `#a15c00`; approved `#bff0df`/`#0f5132`/`#2c8a64`; rejected `#c0261a`/white/`#7f150d`; cancelled `#f0f0f3`/`#45454d`/`#85858e` | brief: State chips |
| row washes | pending `#fff8ec`, approved `#f1faf5`, rejected ground, cancelled `#f3f3f6`; hover one step darker | brief |
| danger text | `#b42318` | decided: refusals need a text-contrast tone |
| claim-differs line | `#8a4b00` | decided: the pending family's deep amber, so the mismatch reads as part of the waiting claim, not as a refusal |
| calendar mark tones | recorded `#1f7a55`, incomplete `#9a5800`, leave approved cyan `#0e7490`, leave pending `#5d5d00`, waiting `#b42318` | brief: each mark is its own shape as well as a tone; decided: five tones that each clear 4.5:1 on white |
| checked state chip | indigo `#3f3c84` fill, white text (9.7:1) | decided: DESIGN.md gives the selected filter to indigo, the selection tone; violet is reserved for one action |
| strong button (dialog `Save`, `Apply filters`) | ink fill, white text | decided: violet is reserved for one action |
| self-approval switch | pill track with a `#5f5f68` edge and its knob held left, help line always beneath | brief: Public screens (`switch … off and disabled`) |

## Type

Open Sans variable 16/26 body, rows 16/22, pane prose 18/29, captions 12/18; Poppins 600 h1 34/42 at every tier
and in the pane (2.125 times body; long headings wrap), screen headings h2 24/32 (1.5 times body), panel headings 20/28 (1.25 times body: evidence blocks, pane parts,
expanded row, policy groups, legend, the month grid's `{Month} {year}` title); tabular figures on `.num`, trail, grid, `time`.
brief: Type.

## Layout per viewport

| Tier | Layout | Basis |
|---|---|---|
| ≥ 1024 | queue 1.75fr beside the pane 1fr (1.95fr from 1280 px), all eight columns, on `/requests` too, where the pane's place is an empty hairline panel (no glyph, no text) until a row is selected; beside the pane, names and figures break only at their spaces (a date, a time and each half of a range stay whole), every row sets at one height (64 px from 1280 px; 84 px from 1024 to 1279 px, where the queue takes 2.4fr beside the pane's 1fr, cell padding tightens further and the Correction column keeps 15ch so its label takes at most three lines), cell padding tightens, and from 1280 px the Correction column keeps 20ch so its label takes at most two lines; a row's Claimed and Recorded show times alone (the pane gives a next-day sign-out its date), so a night shift keeps the one height; the pane scrolls with the page, so `Approve` is reached by scrolling the pane, not the whole queue; the pane's evidence blocks stack in one column; on `/requests/new` from 1280 px dates, times and names stay whole and the Correction column keeps 28ch so the type select shows its longest label, the claimed time fields stack in their cell at 8.5rem each so a time shows whole, the h2 steps down to 20/28 under a tight h1 and the draft row carries a pale-violet top edge; `/policy` sets its four groups in two columns (cap and types left, note and self approval right) with `Save new version` right-aligned in a full-width row beneath both, inside the first 800 px | brief: Width tiers, Screens and layout (`the detail pane empty until a row is selected`, rows of one height); decided: proportion and wrapping keep eight columns without sideways scroll at 1024 px, and the policy's primary action shows on its first screen |
| 640–1023 | the pane keeps its place; calendar marks keep glyph, word and number visible (`{mark}: {count}`), wrapping only at spaces, with the glyph above the words from 640 to 767 px; state chips tighten; `Correction` and `Claimed` leave first, then (with the pane open) `Raised` and `Recorded`; on `/requests/new` the draft's `Correction type` and claimed-time fields, whose columns have left, sit in the full-width cell beneath beside `Reason`; the breadcrumb shows its last two steps | brief: Width tiers; decided: the fields follow their columns out of the row so the leaving order holds and raising stays possible (DP-68) |
| < 640 | rows are cards (state + person first line, labelled facts beneath); a request is its own screen; `Approve` above `Reject`, full width, fixed to the bottom; sheet slides up; calendar marks keep glyph, word and number visible, the glyph above its `{mark}: {count}` words (12/15), which break at a syllable inside the cell to fit the seven columns | brief: Width tiers, Journeys 7 ("Each count has its own mark shape and word"); decided: stacking and in-cell breaking keep the words visible without sideways scroll |

Top bar sticky at 64 px, the initials disc with the role line beneath it (brief: Chrome); signed out, `/login` carries the brand mark only, with no breadcrumb (brief: Chrome, signed-in routes); table header sticky under it. No route scrolls sideways (brief: Width tiers). `Previous versions` is a table, newest first, at every tier (brief: The policy screen); its five columns (`Version`, `Cap`, `Lookback`, `Note on approval`, `Saved`, the last holding the saver's name above the moment) wrap at their spaces (below 360 px a date may also break at its hyphens, so the table still fits), and each version's enabled correction types take a full-width cell beneath its row (decided: five long labels cannot share a column at 375 px, and the draft row's reason already sits this way).

## Motion

| Moment | Duration / easing | Basis |
|---|---|---|
| press, hover | 100 ms `cubic-bezier(.4,0,1,1)` (`transform`, `background-color`) | brief |
| row wash, chip cross-fade, chevron quarter turn | 200 ms `cubic-bezier(.4,0,.2,1)` | brief |
| pane fade between requests | 200 ms cross-document view transition scoped to the pane (`view-transition-name: pane`, root excluded); only when one request's contents give way to the next request's | brief: Motion (pane); decided: the view transition keeps the pane element itself out of partial opacity, so its text always clears contrast |
| pane after a decision, withdrawal or 409 | no fade: the redrawn pane appears at once; only the row wash and chip cross-fade move | brief: Motion (signature moment; "Other named moments, and only these") |
| filter sheet | slides in from the right (≥ 640) or up from the bottom (< 640), 260 ms `cubic-bezier(.3,1.3,.6,1)`; leaves in 180 ms | brief: Motion (sheet) |
| toast | slides down a short way and fades in, 260 ms `cubic-bezier(.3,1.3,.6,1)`; fades out in 200 ms | brief: Motion (toast) |
| validation message under its field | fades in, 200 ms `cubic-bezier(.4,0,.2,1)` | brief: Motion (validation message) |
| `Shared link` field after a mint | fades in, 200 ms `cubic-bezier(.4,0,.2,1)` (WAAPI); reduced motion: appears at once | brief: Motion (shared-link field) |
| shared month | no motion at all, and no script | brief: Motion, Deployment |
| confirmation dialog, callouts, inline refusals | appear and disappear at once (no motion) | brief: Motion lists only the named moments |
| busy arc | 1100 ms uneven loop, only while a read or send is in flight: beside `Loading requests` during the queue re-read, and inside the sending control (`Sign in`, `Send for approval`, the pressed `Approve`/`Reject`, `Withdraw`, the dialog's `Save`) until the answer arrives; reduced motion shows it still | brief: Motion |
| toast stay | 6 s, paused on hover/focus | brief |
| reduced motion | every animation and transition removed; view transitions off; WAAPI skipped | brief |

## States

Empty (role sentence / filter sentence + `Clear filters`, glyph enlarged), loading (`Loading requests` + arc), read
failed (`The queue could not be loaded. Try again.` + `Try again`), 404 `That page does not exist` + `The link may be out of date. Go back to the desk.` as one plain sentence, 403 `Your role
does not have access to this page.`, 400 `That filter is not one the queue understands.` + `Clear filters`, 500
`The desk could not complete that. Try again.`. brief: Feedback states.

## Media and licences

Inline SVG icon set drawn for this app (17 icons including link and download, 24 grid, stroke 2): original. Fonts
`public/fonts/open-sans-latin-wght-normal.woff2` and `public/fonts/poppins-latin-600-normal.woff2` from Fontsource
5.3.0, OFL-1.1 (`assets.json`, `THIRD_PARTY_NOTICES.md`). No images.

## Decided deviations from defaults

- The row link is the brief's pair, accessible name `Open request {id}` and visible text the person's name (brief: Public screens). How this pair sits with DP-55 is an open dispute for triage, not settled here.
- `pg` is pinned to 8.3.3 with `semver` overridden to 7.8.5: every later `pg` declares the optional peer `pg-native`,
  which `npm ls --omit=dev --all` reports as a second, unlicensed driver (brief IF-04..IF-06 define shipped packages by
  that command).
- `run.json` installs with `npm ci --package-lock-only=false`, which is plain `npm ci` from the lockfile; the shipped
  tree that `npm ls --omit=dev --all --json` reports after that install is the one listed in `THIRD_PARTY_NOTICES.md`
  (brief IF-04..IF-06 define shipped packages by that command).
- The browser reuses `src/text.mjs` (grapheme count) and `src/time.mjs` (`{expires}` in Kestrel Works time), served as
  modules beside `src/queue-query.mjs`, so each rule stays in one place (decided: brief Engineering standards).
- Trail lines are drawn as one text run (`Approved by {actor}, {role}`), so a verb never stands alone where a state
  chip's word would (decided: brief Visual design, a state reads as a chip carrying its word).
