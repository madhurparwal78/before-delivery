# TRUTH.md — Tallwind Business Banking Cockpit

The golden's ground truth. Every value is marked `brief: <section>` (stated in `instruction.md`) or
`decided: <why>` (the brief is silent; the value follows its words). The app is a TypeScript server on
Node 22 (plain `node:http`, `pg`) over PostgreSQL (`DATABASE_URL`), serving server-rendered pages and
small browser TypeScript bundles; `run.json` runs `npm ci`, `npm run build`, `exec node dist/server/main.js`
on `0.0.0.0:${APP_PUBLIC_PORT:-4173}`. brief: Deployment.

## Journeys: the ideal flow

### J1. Start, health and seed (DP-40, DP-46, DP-72, IF-01..IF-03)
1. The server listens at once. While the database is unreachable `GET /api/health` answers `503 {"status":"unavailable"}` and API requests answer `503 service_unavailable`; it retries every 2 s and never exits. brief: Server boundary.
2. When the database first answers it applies the schema (with the append-only audit triggers) and writes the seed dated from the New York date on the business clock at that moment, then health answers `200 {"status":"ok"}`. brief: Server boundary, Seed data.
3. `USER_README.md` lists the four logins and the password; `.browser_screenshots/` and `.downloads/` exist. brief: Deployment.

### J2. Visitor to cockpit (DP-37..DP-39, DP-60, DP-68, DP-32, DP-33, DP-84)
1. Home: announcement strip, serif h1 "Calm banking for companies on the move", email field with "Open account", "Launch demo", tour video with captions and transcript. brief: Home.
2. Header menus open by Enter, Space or Down Arrow, move and wrap with arrows, Home and End, close on Escape, Tab past the last link or an outside click. brief: Interactions.
3. Pricing: "Annual Pricing (15% off)" mirrors `?billing=annual`, one history entry per toggle, prices count up on entering view. brief: Pricing and the address.
4. Sign up creates a company with one Checking account at $0.00 and lands on `/app`; log in lands on a safe `next` or `/app`. brief: Sessions.

### J3. Owner reads the cockpit (DP-01..DP-08, DP-47, DP-76..DP-78)
1. `/app` shows the Total cash card and one card per account with balance, "Available $…" and a 30-point sparkline; "Send payment" pill; "Read balances aloud". brief: Cockpit home.
2. The rail is inline from 1024px and a drawer below it; cards are 1, 2 or all-in-one-row at <600, 600–1023, ≥1024. brief: Cockpit breakpoints.
3. The feed lists newest first with filters mirrored in the address (`account`, `method`, `direction`); refreshes every 10 s, on stream events and after outages keep every row, focus, search text and statement month. brief: Feed refreshes.
4. Statement: "Statement month" (12 months, newest first) and "Download statement" save `<account>-statement-<YYYY-MM>.csv`. brief: Account page, Download statement.

### J4. Recipients (DP-09..DP-13, DP-55, DP-62, DP-70, DP-80, DP-91)
1. Add: Display name, Kind, Method, Account number, Routing number; refused fields show the brief's copy under the field, take `aria-invalid`, and the first one gets focus. brief: Interactions, Feedback states.
2. Remove: dialog opens on "Keep", Tab wraps between Keep and Remove, Escape returns focus to the opener; history is kept. brief: Interactions.
3. Control+K opens the "Command palette" from any control; typing lists Pages and Recipients; only the answer for the current text is shown. brief: Command palette, Latest answer wins.

### J5. Send payment (DP-14..DP-20, DP-61, DP-71, DP-81, DP-85, DP-86)
1. The draft lives in the address in the order source, recipient, method, amount, memo, send_on, step; typing replaces the entry, a passing review adds one. brief: Send payment draft and the address.
2. The settlement line comes only from `GET /api/me` and refreshes after `settlement_dates_change_at`. brief: Send payment.
3. "Confirm and send" posts once with a per-review `Idempotency-Key`; a revoked session lands on Log in carrying the draft address and returns to the same review step. brief: Interactions.
4. Posted: "Payment sent" (+ " Settles on <date>"), the celebration shower; held: "Payment awaiting approval"; scheduled: "Payment scheduled" (+ " Scheduled for <date>"). brief: Feedback states.

### J6. Approvals (DP-21..DP-25, DP-48, DP-63, DP-74, DP-82, DP-87, DP-88)
1. Over $5,000.00 waits; over $50,000.00 needs two distinct approvers; the creator cannot approve; any owner or admin may reject. brief: Business rules.
2. The page re-reads every 5 s, keeps each row's element and the focused button, names buttons "Approve $… to … from …" with " (payment k of m)" for twins, and moves focus Next-row Approve, previous-row Approve, or the heading. brief: Approvals.
3. A held payment expires at 00:00 New York on the fifth Federal Reserve business day after its New York creation date; its hold is released once. brief: Approval expiry.

### J7. Money in and between accounts (DP-26..DP-29, DP-58, DP-75, DP-92)
Mark paid credits the stored invoice total once; a draw credits the funding account and raises `drawn_cents`; a lost draw answer is retried with its own key; a transfer writes a paired debit and credit, locking accounts in id order. brief: Business rules.

### J8. Access control and sessions (DP-30, DP-31, DP-49, DP-50, DP-59, DP-65, DP-66, DP-73, DP-89, DP-93)
Another company's ids answer 404; a forbidden role answers 403 before any state; errors reveal nothing; five failures per email lock for 15 minutes; Log out stops every request, timer and stream of the page and clears the stored token and last account. brief: API, Sessions.

### J9. Sales inquiry (DP-34, DP-35, DP-36, DP-67)
`/contact` counts message characters like the server, shows each refusal under its field, and sends one inquiry. brief: Contact, Sales inquiries.

## Palette
See DESIGN.md `## Palette`: ground #fbfcfd, surface #ffffff, secondary #f4f5f9, ink #272735, body #535461, muted #666673, accent #4659dc, money in #12795a, money out #b34700, danger #c0266a, rail #1e1e2a / #ededf3, credit tint #edecfb, sand tint #f6f5f2, avatars #cee3e7 #dbe4cc #e3ddee #e9e1ce. brief: Visual design (roles); hex values decided to meet WCAG 2.2 AA.

## Type
Figtree variable (sans), Instrument Serif regular and italic (editorial headlines), IBM Plex Mono 400/500/600 (every amount). 16px root, 14px rows, 12px captions, 18px lede, 24px headings, 64px/40px hero. brief: Visual design (Type). Fonts are OFL-1.1, self-hosted woff2.

## Layout per viewport
| Viewport | Layout | Source |
|---|---|---|
| 320–599 | one column, cards one per row, rail is a drawer, Approvals rows stacked, "Open Menu" on marketing | brief: Cockpit breakpoints |
| 600–1023 | cards two across, rail drawer behind "Accounts menu", "Open Menu" on marketing | brief: Cockpit breakpoints |
| 1024+ | rail inline (15rem), all cards in one row, inline marketing header | brief: Cockpit breakpoints |
| 1536+ | content column stops at 96rem and centres | decided: comfortable reading width |

## Motion
| Moment | Duration | What moves | Reduced motion | Source |
|---|---|---|---|---|
| control hover and press | 100–150 ms | colour; press sinks 1px | colour change only | brief: Motion |
| cards and new rows | 300 ms | opacity, translateY 6px | at rest | brief: Motion |
| menus, palette, dialogs | 250 ms | opacity, scale 0.98 | instant | brief: Motion |
| drawer, narrow menu | 300 ms | translateX | instant | brief: Motion |
| Approvals row leaving | 200 ms | opacity | removed instantly | brief: Motion |
| toast | 300 ms in, 500 ms out | opacity, 4px blur | instant | brief: Motion |
| pricing count-up | 900 ms | price text | final value | brief: Motion |
| scroll reveal | scroll range | cover scale | uncovered | brief: Motion |
| celebration | 1.8–2.7 s | 18 notes fall 105vh and fade | not created | brief: Motion |

## States
loading: static skeleton bars; empty: one sentence; field error: magenta message under the field; success: toast in the single status region; outage: "Tallwind can't be reached right now. Try again in a moment." once per outage, then "Tallwind is back online."; denied: Approvals rows without buttons for a member. brief: Feedback states.

## Breakpoints
600px (cards two across), 1024px (rail inline, marketing header inline), 40rem (hero headline 40px). brief: Cockpit breakpoints, Visual design.

## Media and licences
No photographs, no video file. Original SVG art (`favicon.svg`, `cockpit-still.svg`) licence `original`; inline line icons are original; fonts OFL-1.1 (Figtree, Instrument Serif, IBM Plex Mono); one runtime package `pg` (MIT) and its MIT dependencies.

## Judged criteria mapping
See DESIGN.md `## Judged criteria mapping`.
