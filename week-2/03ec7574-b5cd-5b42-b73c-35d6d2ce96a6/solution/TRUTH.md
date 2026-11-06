# TRUTH.md — Corvo

The ground truth of the shipped build in `app/`: an Express server (`src/server.js`) that renders
complete HTML documents from tagged templates (`src/web/`), serves the JSON API under `/api` from `src/api.js`, keeps every record in PostgreSQL
through one pool (`src/db.js` over the wire client `src/pg.js`, `tx()` for transactions) and upgrades the pages with one plain script
(`public/js/app.js`). Every value below is marked `brief:` with the instruction.md section it comes
from, or `decided:` with the reason the build chose it where the brief is silent.

## Ideal flow of every journey

### 1. A payout waits for two approvers (DP-01, DP-03)

1. Omar Patel signs in at `/login` (`nw.operator@example.com`, `deku-demo-pw-2026`) and lands on `/console`. brief: Problem and users
2. On `/console/wallets/wal_operating` he types `0x1111111111111111111111111111111111111111`, `15000` and memo `October hardware` into the Send form and presses `Send`. brief: Journeys
3. The server runs the checks in order: role, wallet, body, frozen, policy (`Vendors under daily cap` allows: the daily outflow is the seeded `12000` waiting plus `15000`), available balance; `15000` is at or above the floor `10000` and the wallet has `kq_finance`, so the intent is `pending_approval` with `required_approvals` `2`, the three quorum members copied in and `expires_at` = `created_at` + `604800`. brief: Business rules (Transfers)
4. The form is swapped in place and shows `Waiting for approval: 0 of 2 approvals`; Available drops by `15000`, Balance stays. brief: Public screens and controls (Console)
5. Ada Byrne opens `/console/approvals`; the row shows the wallet name, `0x1111…1111` with the full address as its title, `15000 USDC`, the memo, `Omar Patel`, `10080 min left`, `ALLOW: Vendors under daily cap` and a progress bar with `0 of 2 approvals`. She presses `Approve`; the bar fills to half on the spring and the row leaves her inbox. brief: Public screens and controls (Console)
6. Omar Patel's own inbox never lists the row. brief: Business rules (Approvals)

### 2. The deciding approval executes it (DP-02, DP-03, DP-04)

1. Ben Okoro opens `/console/approvals`, reads `1 of 2 approvals` and presses `Approve`. brief: Journeys
2. Inside one transaction the intent row is locked (`SELECT … FOR UPDATE OF i`), the approval is recorded, the count reaches `2`, the balance is debited and `executed_at`, `decided_at` and `tx_hash` (`0x` + SHA-256 of `corvo-tx:<id>`) are set; `intent.approved` then `intent.executed` are appended to the audit chain and the signed event log. decided: one transaction with row locks so racing final approvals execute once
3. The toast reads `Transfer executed` and the row is gone; `/console/intents` shows the row `executed` with `2 of 2`, and expanding it shows the hash. brief: Journeys

### 3. A policy blocks a transfer (DP-09, DP-10)

1. Omar Patel sends `100` to `0x000000000000000000000000000000000000dead`. brief: Journeys
2. `Block burn address` matches first as a DENY rule: `403` `POLICY_DENIED` with `details` `{"rule": "Block burn address", "reason": "matched_rule"}`; no intent, no reservation, one `transfer.denied` audit event and one signed event naming the rule. brief: Business rules (Transfers, Audit chain)
3. The Send form keeps the typed address and amount and reads `Blocked by policy rule Block burn address`. brief: Public screens and controls (Console)

### 4. Simulating a capped vendor (DP-08, DP-12)

1. Nadia Owens opens `/console/policies/pol_operating`; the rule editor lists the four seeded rules in order with `Name`, `Method`, `Action`, `Field source`, `Field`, `Operator` and `Value`. brief: Public screens and controls (Console)
2. In `Simulate` she picks `transfer`, `Operating USDC`, `0x2222222222222222222222222222222222222222` and `60000` and presses `Simulate`. The panel is swapped in place: `DENY` beside `no rule matched` and `Daily outflow` with its value; nothing is written. brief: Journeys
3. A refused save shows the message and the path such as `rules[0].conditions[0].value` and keeps the edits; a good save reads `Policy saved, revision 2`. brief: Public screens and controls (Console)

### 5. A visitor asks sales (DP-50, DP-51)

1. A visitor on `/contact` fills `Full name`, `Work email` with a free mail address, `Company`, `Monthly volume` and `How can we help?` and presses `Send message`. brief: Journeys; decided: button label `Send message`
2. The page re-renders with `Use your work email` under the field, the field marked `aria-invalid` and described by the message, every typed value kept. brief: Public screens and controls (Contact)
3. A valid send replaces the form with `Thanks. Our team will reply within one business day.` brief: Public screens and controls (Contact)

### Supporting flows

- **Sign in and redirects (DP-39).** `/console/intents` signed out lands on `/login?next=/console/intents`; a wrong pair reads `Email or password is incorrect` and keeps the email; the right pair returns to `/console/intents`; any `next` that is absolute or starts with two slashes lands on `/console`; `Sign out` returns to `/`. brief: Screens and layout (Entry and redirects)
- **Inline create and freeze (DP-21).** `Create wallet` opens the inline row at the top of the wallets table (`Name`, `Chain`, `Asset`, `Approval floor`, `Policy`, `Quorum`, `Create`); the toast reads `Wallet created`; the wallet page lists activity newest first or `No deposits or intents yet`; `Freeze wallet` swaps the Send form for `This wallet is frozen. New transfers and approvals are paused.` brief: Public screens and controls (Console), Feedback states
- **Reject and cancel (DP-16, DP-18).** `Reject` opens a required `Reason` field and `Confirm reject`; an empty reason never reaches the server; a reason ends the intent with the toast `Intent rejected`. A refused approval (frozen wallet) keeps the row with the server's message. `Cancel request` in an expanded intents row reads `Intent cancelled`. `Load more` appends the next `20` rows in place; the status filter is a row of capsule chips (`All`, `Pending approval`, `Executed`, `Rejected`, `Cancelled`, `Expired`) that swap the list in place and keep the URL (`?status=`). decided: six values read faster as chips than in a select brief: Public screens and controls (Console), Interactions
- **Audit and settings (DP-34).** `/console/audit` reads `Chain verified: N events` (recomputed in the browser from the loaded events), a broken hash reads `Chain broken at event N`; the `Signed event log` tab (an ARIA tablist beside `Audit trail`, switched in place, arrow keys move between tabs) lists seq, id, type, time and signature. `/console/settings` shows the app id with `Copy`, members, and for owners `Key name`, `Key role`, `Create key` with the new secret once beside `Copy this key now. It will not be shown again.`, and the masked webhook secret with `Reveal` and `Rotate` (`Signing secret rotated`). brief: Public screens and controls (Console); decided: field labels
- **Batches (DP-22).** Lines are validated whole, each line is decided with method `batch_payout` and aggregations that include the earlier lines; one intent of kind `batch` holds the total. brief: Business rules (Batches)
- **Expiry (DP-14).** Expiry is applied against server time whenever an intent, a list or a decision touches it, and by a one-second sweep in `src/server.js`; `intent.expired` is dated at `expires_at` with actor `system`. brief: Business rules (Expiry)

## Palette

| Role | Value | Used for | Source |
|---|---|---|---|
| paper | #ffffff | page background, cards, inputs | brief: Visual design (Palette roles) "white"; decided: exact value |
| mist | #f8f9fc | alternating section bands, console rail, table header rows | brief: Visual design; decided: exact value |
| haze | #f1f2f9 | selected rows and chip backgrounds | brief: Visual design; decided: exact value |
| ink | #010110 | headings, primary text, the dark capsule | brief: Visual design; decided: exact value |
| ink soft | #111117 | card headings and body copy | brief: Visual design; decided: exact value |
| graphite | #2e2e3d | secondary body copy | brief: Visual design; decided: exact value |
| slate | #70707d | closing phrase of display headings, captions, helper text | brief: Visual design; decided: exact value, 4.88:1 on paper |
| line | #e2e3f0 | 1px dividers, card and input borders | brief: Visual design; decided: exact value |
| violet | #5b4ffe | dark capsule hover fill, focus ring, active rail item, console link hover | brief: Visual design; decided: exact value, 5.26:1 with paper |
| violet tint | #8b86ff fill, #c9c6ff text on ink | approval progress fill, role badge text | brief: Visual design; decided: exact value |
| success | #c6f4dd fill, #0b5534 text | `executed` and `active` badges | brief: Visual design; decided: exact value |
| danger | #c62828 | `rejected` badges, denials, error text | brief: Visual design; decided: exact value |
| info | #d3e3fd fill, #0b3a8c text | `pending_approval` badge | brief: Visual design; decided: exact value |
| muted | #ececf1 fill, #3d3d4a text | `cancelled`, `expired`, `frozen` badges and a zero rail count | brief: Visual design (muted) |

## Type

| Token | Family | Weight | Size / line height | Used for | Source |
|---|---|---|---|---|---|
| display | "Helvetica Neue", Arial, ui-sans-serif, system-ui, sans-serif | 400 | 58px / 64px, tracking -1.74px | hero heading | brief: Visual design (Type); decided: size |
| section | display stack | 400 | 42px / 48px, tracking -1.26px | section headings | brief: Visual design (Type); decided: size |
| stat | display stack | 400 | 52px / 60px | stat numerals | brief: Visual design (Type); decided: size |
| card heading | Inter, ui-sans-serif, system-ui, sans-serif | 500 | 22px / 28px | card headings | brief: Visual design (Type); decided: size |
| lead | Inter stack | 300 | 20px / 30px | hero lead, section intro | brief: Visual design (Type) weights; decided: size |
| body | Inter stack | 400 | 14px / 20px | body copy, forms | brief: "a compact body size"; decided: size |
| table | Inter stack | 400 | 13px / 20px | console tables | decided: compact console density |
| caption | Inter stack | 600 | 12px / 20px | captions, badges, table headers | brief: "small captions"; decided: size |
| label | Inter stack | 500 | 14px / 20px | buttons, rail items, field labels | decided: within the four pinned weights |

No font file ships; the fallback stacks apply. Under 810px the display token drops to 38px / 44px and
section headings to 30px / 36px so the hero holds on few lines. decided: hero must stay readable at 375px

## Shape and depth

| Token | Value | Source |
|---|---|---|
| capsule radius | 100px on every button and chip | brief: Visual design (Shape) |
| card radius | 12px | brief: "cards gently rounded"; decided: value |
| input, menu, table wrapper radius | 8px | brief: "inputs and menus a little less"; decided: value |
| badge radius | 4.5px | decided: badges read as tags, not capsules |
| card shadow | a soft drop shadow 10px below with 30px blur at 25% black, spread -20px | brief: "a soft floating shadow"; decided: value |
| header glass | translucent paper with a 4px backdrop blur | brief: "frosted white glass"; decided: value |
| focus ring | 2px solid violet outline, 2px offset | brief: "a visible focus ring on every control"; decided: value |

## Layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| phone, 375 x 812 | one column everywhere; header shows the diamond, `Corvo` and `Menu`, which opens a full-height sheet; product and developer cards one column; stats two by two; case cards a sideways scroll-snap row; console rail hidden behind a top bar `Menu`; console tables become stacked label and value cards with `Approve` and `Reject` in the row | brief: Screens and layout (Responsive behaviour) |
| tablet, 810 to 1199 | card grids and stats in two columns; header uses the `Menu` sheet below 1100; console tables stacked as cards | brief: "At tablet widths card grids use two columns"; decided: thresholds |
| desktop, 1280 x 800 and wider | product cards in four columns from 1200; full header with the four menus, `Pricing`, `Docs`, `Log in`, `Get started`; console rail fixed on the left with table-first work surfaces; content max width 1200px | brief: "On a desktop the product cards use four columns"; decided: thresholds |
| 1440 | hero heading on at most two lines | brief: Public screens and controls (Hero) |

## Console chrome

| Element | Treatment | Source |
|---|---|---|
| page head | the page title row stays sticky at the top of the work surface on paper with a 1px line below; `scroll-padding-top` keeps scrolled-to controls clear of it | decided: the title stays in view over long tables |
| header menus | each panel is a three-column row of links with captions under its button, 600px wide | decided: a compact panel keeps the hero readable while a menu is open |
| toasts | bottom right, never intercept the pointer (`pointer-events: none`) | decided: feedback must not cover controls |
| touch targets | every control is at least 44px tall under 810px | decided: WCAG target size on phones |

## Breakpoints

| Width | What changes | Source |
|---|---|---|
| up to 360 | hero heading 32px; stacked table labels above their values | decided: the narrowest phones keep long ids and addresses inside the screen |
| up to 809 | one column; menu sheet; console top bar with `Menu`; case scroller; stats two by two | brief: Responsive behaviour; decided: threshold |
| up to 1099 | public header collapses to the `Menu` sheet | decided: the full header needs about 1100px |
| up to 1199 | two-column card grids; console tables stacked as label and value cards | brief: tablet two columns; decided: threshold |
| from 1200 | four product card columns | brief: desktop four columns; decided: threshold |

## Motion

| Name | Duration | Curve | What moves | Source |
|---|---|---|---|---|
| spring-rise | 600ms transform, 400ms opacity | overshooting spring on transform, ease-out on opacity | sections below the hero rise 40px into place once when a fifth is visible (IntersectionObserver, unobserved after the first hit) | brief: Motion and effects; decided: values |
| blur-in | 500ms per word, 40ms stagger | ease-out | display heading words and the hero lead sharpen from an 8px blur | brief: Motion and effects; decided: values |
| card-lift | 200ms | ease-out | linked cards rise 6px and deepen their shadow on hover and focus | brief: Motion and effects; decided: values |
| pill-fill | 200ms | ease-out | background-color and border-color of capsules | brief: Motion and effects; decided: values |
| spinner | 1000ms, endless | linear | a 14px ring turning beside a busy button (`aria-busy`) | brief: Motion and effects; decided: values |
| progress-fill | 400ms | the same overshooting spring | the approval bar width, played with `element.animate()` on the row before the inbox re-renders | brief: Motion and effects; decided: values |
| toast-in | 200ms | ease-out | toasts fade and rise 8px in | decided: feedback must arrive visibly |

Under reduced motion every transition and animation is removed: revealed sections rest at
`matrix(1, 0, 0, 1, 0, 0)` and opacity 1 from first paint, words rest at `blur(0px)`, cards stay put,
the bar jumps, and a busy button shows the word `Working` in place of the spinner. Console pages never
animate on scroll. brief: Motion and effects

## States

| State | Treatment | Source |
|---|---|---|
| empty | `Nothing waiting for your approval`, `No intents yet`, `No deposits or intents yet`, `No wallets yet`, `No policies yet`, `No API keys yet`, `No signed events yet` | brief: Feedback states; decided: the lists the brief does not name |
| busy | every submitter in flight (sign in, contact and every console form) carries `aria-busy` and a spinner; under reduced motion its label reads `Working`; a second press is ignored | brief: Motion and effects |
| success toast | `Wallet created`, `Transfer executed`, `Intent rejected`, `Intent cancelled`, `Deposit recorded`, `Policy saved, revision N`, `Signing secret rotated` | brief: Feedback states |
| send outcomes | `Transfer executed`, `Waiting for approval: 0 of N approvals`, `Blocked by policy rule <rule name>`, `Blocked by policy: no rule allowed this transfer`, `Not enough available balance` | brief: Public screens and controls (Console) |
| field error | danger text under the field, `aria-invalid="true"`, `aria-describedby` to the message, typed values kept | brief: Public screens and controls (Contact) |
| row error | the server's message as `role="alert"` on the approvals row, row kept | brief: Public screens and controls (Console) |
| denied page | `You do not have access to this page` for operators and approvers on `/console/audit` | brief: Screens and layout |
| missing record | `Not found` for a wallet, intent or policy outside the member's organization | brief: Screens and layout |
| frozen | `This wallet is frozen. New transfers and approvals are paused.` and no Send form | brief: Feedback states |
| badges | `pending_approval` info, `executed` success, `rejected` danger, `cancelled`, `expired`, `frozen` quiet, `active` haze; every badge carries its word | brief: Visual design, Feedback states |
| not found | custom 404 page with a link to `/` | brief: Browser support and performance |

## Judged-criteria mapping

| Criterion | Satisfied by |
|---|---|
| B1 | `int_seed_pending` row on approver 2's `/console/approvals`: violet tint fill at width 50% beside `1 of 2 approvals` |
| B2 | owner-started intent approved by both approvers; the second approval swaps the inbox and the toast reads `Transfer executed` |
| B3 | wallet page facts after a waiting send: Available `80 USDC`, Balance `100 USDC` |
| B4 | Simulate panel swap: `DENY` and `no rule matched` (daily outflow `12000` waiting plus `60000` exceeds the cap) |
| B5, B6 | intents table badges: `executed` on success mint, `pending_approval` on info blue, words always shown |
| B7, B8 | console rail on mist with Overview, Approvals and its count, Intents, Policies, Quorums, Audit, Settings; work surface on paper |
| B9 | overview wallets table with the nine columns |
| B10 | `Create wallet` toggles the `create-row` inside the table head of the body |
| B11 | frozen banner rendered where the Send and Deposit forms were |
| B12 | product cards on the card shadow token with the 12px radius |
| B13 | display heading words in ink, closing phrase `digital assets` in slate |
| B14 | comparison matrix tick icons (`Included`) for Policy engine and Key quorum approvals under Developer and Enterprise |
| B15 | sticky header with translucent paper and backdrop blur |
| B16 | quorums table: `2 of 3` beside `Ada Byrne, Ben Okoro, Nadia Owens` |
| B17 | no consent banner and no logo strip on the landing page |
| B18 | hero `panel-demo`: drawn pending transfer card with a half-filled bar and `1 of 2 approvals` |
| B19 | case cards as mist tiles carrying Northline, Paygrid, Tidepool and Fennick in the display face |
| B20, B21 | settings: secret shown once in `secret-once`, only the prefix listed after reload; webhook secret masked as `whsec_` plus dots until `Reveal` |
| B22, B23 | phone header with diamond, `Corvo` and `Menu`; stacked label and value cards for console tables |
| B24 | `wal_gas` Balance `12.5 ETH` from raw `12500000000000000000` |
| B25 | audit trail rows: seq, time, type, actor, subject and the 12 character hash prefix |
| B26 | owner `New quorum` form adds a row to the key quorums table |
| B27 | contact form fields in one column at 375px |
| B28 | hero `Contact sales` capsule links to `/contact` |
| B29 | English copy on `/`, `/pricing`, `/contact` and `/login` |
| S1 | every service module reads and writes through `src/db.js` against PostgreSQL at `DATABASE_URL`; no in-memory stores |
| S2 | `src/services/policy.js` and `src/lib/core.js` compute decisions, aggregations, amounts, addresses and hashes from stored rows only |
| S3 | `src/api.js` resolves the credential, app id and role before calling the services, which also scope every query by `organization_id` |
| Q1 | `src/services/intents.js` locks the wallet (`FOR UPDATE`) before reserving and the intent (`FOR UPDATE OF i`) before deciding, inside `tx()` |
| Q2 | `src/services/audit.js` appends audit and signed events on the caller's transaction client after locking the organization row |
| Q3 | one `envelope()` in `src/api.js` answers successes, refusals and unexpected errors |
| Q4 | `src/config.js` reads `DATABASE_URL`, `APP_PUBLIC_URL` and `APP_PUBLIC_PORT`; the listener binds `0.0.0.0` |
| Q5 | `src/lib/core.js` parses, compares and formats amounts as BigInt base units |

## Media and licences

No binary asset ships (`app/assets.json` is `[]`). Every icon is inline SVG drawn for this app
(`src/web/icons.js`, licence `original`); case photographs are mist tiles carrying the
fictional name in the display face; no font file ships. brief: Zero-asset substitution. The only runtime
package is express; its tree is MIT, ISC or BSD-3-Clause, listed in `app/THIRD_PARTY_NOTICES.md`.
