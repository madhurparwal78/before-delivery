# TRUTH — Hollowmere Strongroom Ledger

The brief made concrete. Every value names its origin: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys

### 1. Sign in and read exposure
- Start: signed out, holding `/vault/breaches/<id>` (brief: Journeys 1).
- `GET /vault/breaches/<id>` answers 302 to `/?next=%2Fvault%2Fbreaches%2F<id>` (brief: Routing). `/` shows the
  Hollowmere wordmark, heading `Strongroom Ledger`, one line and `link "Sign in"` pointing at
  `/auth/login?next=<same value>` (brief: Screen routes, Routing).
- `/auth/login` stores a pending sign-in row (state, nonce, PKCE verifier, raw `next`) in Postgres, sets only
  `strongroom_signin` (HttpOnly, SameSite=Lax) and answers 302 to `<AUTH_ISSUER_URL>/protocol/openid-connect/auth`
  with `state`, `nonce`, `code_challenge` (S256) and `redirect_uri=<origin>/auth/callback` (brief: Sign-in routes).
- The realm returns to `/auth/callback`; the app consumes the pending row in one conditional UPDATE (same
  browser, same state, unused, younger than `SIGNIN_PENDING_SECONDS`), exchanges the code with the verifier,
  checks the ID token nonce and audience, sets `strongroom_session` and answers 303 to the checked return path
  (brief: Return after sign-in). End: the breach page, heading `Breach at <company>`.
- A plain sign-in lands on `/vault`: ledger left, exposure column right at 1280 (brief: Journeys 1).
- Provider end state: one `app_session` row; a new realm account gets exactly one `vault` row with twelve rules, each sent as
  `rule.created`; the start-up seed likewise notifies each holding, rule, breach and the grant it writes (brief: Change events)
  (unique `vault.owner_sub` + `INSERT … ON CONFLICT DO NOTHING`) (brief: One vault per account).
- Failure: missing, unknown, reused, expired or other-browser state → 400 page `Sign-in failed` /
  `Sign-in could not be completed. Start again.`; realm unreachable → 503 page `Sign-in unavailable` with the 503
  message (brief: Pages).

### 2. Record and find holdings
- `button "Add holding"` opens `dialog "Add holding"` (Company, Data kind, Value, Notes). Save disables the
  button (`Working...`), POSTs, closes, returns focus to `Add holding`, announces
  `Holding saved. Exposure score <score>.` and the row appears in ledger order with the server's level.
- Search: 150 ms pause (decided: within the brief's "no more than 300 milliseconds"), then `GET /api/holdings?q=…`; selects fetch at once (brief: Filtering). Only the newest
  request's answer paints (sequence number + abort) (brief: Latest input wins).
- Address: `q`, `company`, `data_kind`, `level` in that order, percent-encoded, empty values left out; typing
  replaces the history entry, a select pushes one; Back/Forward restore in place; invalid `data_kind`, `level`,
  over-long `q` are dropped with a replaced entry (brief: Filters in the address).
- `status "Results"` reads `Holdings shown: <n>.` after load, each change and each Back/Forward.

### 3. Tune grading rules
- `/vault/rules`: `list "Rules"` (priority + label per item; `Move rule:`, `Edit rule:`, `Delete rule:` buttons)
  and `region "Preview"` (`table "Preview levels"`, `Projected score <score>`).
- Drag or Space on a handle lifts the rule; neighbours move around it (the handle keeps focus); the Preview asks
  `POST /api/rules/preview` at most every 150 ms; the drop sends `PUT /api/rules/order`.
- Announcements in `status "Rule order"`: `Picked up <label>. Position <p> of <total>.`, `Position <p> of <total>.`,
  `Dropped <label>. Position <p> of <total>.`, `Move cancelled.` (brief: Rule reorder).
- A refused order (422 `rule_ids` or no answer): refetch, Preview back to saved, `alert` `The rules changed in
  another window. The order was not saved.`, focus on the handle.
- Two tabs editing one rule: the second save answers 409 `stale_version`; the dialog stays open with entries kept
  and focus on the alert (brief: Stale edits).
- A rule edit sends `rule.updated`; the contact's stream receives `view.changed` and their scope follows the new
  levels on the next read (brief: Scope checks).

### 4. Log a breach with a blast preview
- `button "Log breach"` opens `form "Log breach"` inside the column; focus in `combobox "Company"`;
  `Announced on` starts at the server's `current_date` (rendered into the page shell) (brief: Logging a breach).
- Suggestions: up to 8 of the vault's companies containing the text, A–Z, in a top-layer popover listbox;
  ArrowDown/Up move `aria-activedescendant`, Enter picks without submitting, first Escape closes the list, second
  closes the form.
- Each tick asks `POST /api/breaches/preview`; a company change after 250 ms. Rows joining light one by one
  (40 ms apart, the 12th onward together), leaving rows clear in reverse, the numeral counts in 420 ms, a
  `Preview` tag shows, and `status "Breach preview"` reads `Preview: holdings touched <n>, projected score <score>.`
- Save sends the form's Idempotency-Key (one per opening); 201 closes the form, shows the committed score, and an
  `alert` `The saved score differs from the preview. Showing the saved score.` only when it differs; status
  `Breach logged. Holdings touched: <n>. Exposure score <score>.`
- Provider end state: one `breach` row, one `breach_request` row holding the stored 201 body, one
  `breach.created` notification (brief: Idempotent breach logging).
- Breach detail: ticking shows `Projected score <score>` beside `Save kinds` at once — the page asks the server
  for the projection of every one-tick change before it paints, and confirms each tick with a fresh request
  (decided: brief "shows the server's projected score"; the answer is the server's, fetched ahead).

### 5. Work the next steps by keyboard
- `list "Next steps"` is one Tab stop (roving tabindex on the first open step); Up/Down/Home/End move; Space or
  Enter toggles; the checkbox flips at once with `Working...`; 200 counts the numeral and announces
  `Step marked done. …` / `Step reopened. …`; 409 already-changed shows the server state and `This step was
  already changed in another window.`; 409 out-of-order rolls back with the API message; failures roll back with
  `Something went wrong. Your change was not saved.`; focus stays on the step (brief: Step toggles).

### 6. Grant a trusted contact
- `/vault/contact` with no grant ever: `No trusted contact. Add one to share a read-only view while you are away.`
- `dialog "Grant access"`: name, email, `radiogroup "Duration"` (24 hours, 7 days, 30 days; 30 days preselected —
  decided: the seeded grant's duration), `group "Levels shown"` (all four ticked — decided: the seeded grant's scope).
- The server wins the grant row under the vault row lock, then creates or resets the realm user (username and
  email lower-case, verified, enabled, first name = contact name, `UPDATE_PASSWORD`, temporary password of 16
  letters and digits). Last name = contact name too (decided: the provided realm's user profile requires a last
  name, otherwise the contact meets an extra profile page and never reaches the callback).
- The dialog shows `Temporary password: <password>` and focuses `Done`; Done removes it for good; status
  `Access granted to <contact name>.`

### 7. Narrow, revoke and expiry
- Narrow: untick, `Narrow scope` (`Working...` while in flight) → `PATCH /api/grant` → `grant.updated`, realm
  sessions of the contact ended; the contact's stream gets `{"type":"grant.updated","id":<grant id>}` and the view
  refetches; status `Scope narrowed.` / `The owner narrowed what you can see.`
  An equal set answers 200 and changes no Strongroom row or event, yet still ends the contact's realm sessions
  (brief: Contact accounts — "Revoking and narrowing end the contact's realm sessions").
- Revoke: `alertdialog "Revoke access?"` → `DELETE /api/grant`: conditional UPDATE picks one winner, contact app
  sessions deleted in the same transaction, `grant.updated` sent, realm sessions ended (queued and retried every
  30 s when the realm is down). Contact stream: exactly one `access-ended`, then closes. Owner status
  `Access ended for <contact name>.`; panel shows `Revoked`.
- Expiry: each contact stream sleeps until `ends_at` by the database clock, re-reads the grant and sends
  `access-ended` within the two-second window; the screen shows `Access ended` / `This shared view has ended. Ask
  the vault owner for a new grant.` and `status "Shared updates"` `Access ended.`

### 8. Delete, idle out and change password
- Holding delete: `alertdialog "Delete holding?"` (focus on `Keep`); `Delete` disables on the first press; one
  `DELETE`, one `holding.deleted`; the ledger opens at `/vault` with focus on `Add holding` and
  `Holding deleted. Exposure score <score>.`
- Idle-out: a covered save answered 401 stores one draft in this tab's `sessionStorage` (fields, ticks,
  Idempotency-Key, version, path, email), opens `/auth/login?next=<path>`, and on return reopens the same form with
  focus on its save button and `Your session ended. Your unsaved entries were kept; check them and save again.`
- Password: `form "Change password"`; the server checks the current password with the realm, sets the new one
  (non-temporary), deletes other owner sessions and every contact session, and ends both accounts' realm sessions;
  status `Password changed. Other sessions are signed out.`

## Palette roles (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | `#0c110f` | brief: Colour roles (near-black, cold green-grey cast); hex decided |
| panel / raised / press | `#111815` / `#18211d` / `#1e2924` | decided: surface steps for panels, hover lift and press |
| rule / rule-strong | `#26302b` / `#3b4842` | brief: Composition (hairlines, stronger company rule); hex decided |
| ink / ink-2 / ink-3 | `#ece4d2` / `#cdc5b3` / `#a8a191` | brief: Colour roles (parchment; High, Moderate, Low at decreasing strength) |
| amber | `#e9a43f` | brief: Colour roles (exposure only: numeral, touched edge, band name — nowhere else, so the Touched word, Preview tag and projected scores use ink) |
| sea-green | `#6fc6a6` | brief: Colour roles (done steps, Clear band) |
| coral | `#f2826e` | brief: Colour roles (Critical badges, delete/remove, errors) |

## Type, space and layout per viewport

- Space Grotesk 700 headings (1.2 ratio: 1.2 / 1.44 / 1.728 rem), IBM Plex Sans 400/600 body 16px, IBM Plex Mono
  400/500 with tabular figures for values, points and scores; numeral 4rem (brief: Type).
- 4px spacing scale; 44px minimum targets; 52px ledger rows (brief: Controls; decided scale).
- ≥ 1024 (1280×800): ledger 3fr left, exposure column 2fr right, sticky at full height below the top bar; Rules
  list left, Preview right (brief: Layouts by width).
- 600–1023 (768×1024): one column; score band fixed under the top bar (numeral, band, Log breach); then form,
  steps, ledger; filter bar on two lines; Rules Preview above the list with its projected line fixed under the top
  bar (brief). 600–899: top-bar labels collapse to icons with accessible names (decided: no sideways scroll).
- < 600 (375×812): as above plus `button "Menu"`; rows become two-line cards; dialogs fill the screen (brief).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| dialogs, breach form, suggestions | open | 160 ms opacity + 6–8 px rise | cubic-bezier(0.16,1,0.3,1) | appear at once | brief: Meaning of motion |
| close of the same | close | 160 ms opacity fade + slight drop, the same time as the entry; the panel is made `inert` and `aria-hidden` at the first frame of the close, so it leaves the focus order and the accessibility tree at once, and it is removed when the fade ends | cubic-bezier(0.16,1,0.3,1) | disappear at once | brief: Meaning of motion ("leave in the same time") + Closed panels |
| ledger row | hover | 160 ms background lift | ease | none | brief: Hover |
| button | press | for the press (`:active`) | — | same | brief: Press |
| step | done | 160 ms text colour | ease | none | brief: Completing a step |
| touched rows | preview answer | 40 ms stagger, 160 ms light; 12th onward together; reverse on leave | ease | still amber edge + `Touched` at once | brief: Blast preview |
| score numeral | preview, step, delete, rule change | 420 ms whole-number count | ease-out cubic | jumps; preview announced politely | brief: Blast preview, Other score changes |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| holding save | `Save holding` disabled `Working...` | dialog closes, announcement | 422 field errors + summary; 409 alert; 401 draft + sign-in; no body → failed-request alert |
| breach save | `Save breach` `Working...` | committed score, announcement | same pattern; Idempotency-Key reused |
| breach kinds save | `Save kinds` `Working...` | announcement, version +1 | stale → ticks from server, alert, projection cleared |
| step toggle | flips, `Working...` | count + announcement | rollback / server state + alert |
| rule save / reorder | `Save rule` `Working...` / lifted rule | announcement | stale alert in dialog / refused alert |
| grant / narrow / revoke | `Working...` | status line | alert; 503 identity message + outage banner |
| password | `Working...` | status line | field errors; 503 message + banner |

## Paint

Each screen (ledger, shared view, Rules, Trusted contact, a holding, a breach) paints once its first data is in,
so no control moves under the pointer after it appears (decided: DP-57/58 usability; no idle spinner is shown).

## Breakpoints

600 and 1024 CSS pixels exactly (`max-width: 599.98px`, `max-width: 1023.98px`) (brief: Browser support).

## Media and licences

| File | Licence | Source |
|---|---|---|
| `app/strongroom/static/fonts/space-grotesk-latin-{500,700}-normal.woff2` | OFL-1.1 | Fontsource 5.3.0 (npm) |
| `app/strongroom/static/fonts/ibm-plex-sans-latin-{400,600}-normal.woff2` | OFL-1.1 | Fontsource 5.3.0 (npm) |
| `app/strongroom/static/fonts/ibm-plex-mono-latin-{400,500}-normal.woff2` | OFL-1.1 | Fontsource 5.3.0 (npm) |
| `app/strongroom/static/mark.svg`, inline icons | original | drawn for this app |
