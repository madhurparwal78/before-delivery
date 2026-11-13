# TRUTH — Fernwick Software Hushline

The golden's ground truth: the brief made concrete. Each value says where it came from: `brief: <section>` (copied
verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flows)

### 1. A player asks for help (brief: Journeys 1)

- Start: a player with no thread opens `/widget/gloamrunner?player=<id>&sig=<hmac>` at 1280 by 800 or 375 by 812. The widget
  calls `GET /api/widget/gloamrunner/me`, shows the heading `Help with Gloamrunner`, the Topic combobox (Bug, Account,
  Purchase, Something else), the Message textbox, `Attach a file` and `Send`.
- Actions: the player picks Bug, types a message, attaches `shot.png` whose name holds path segments and quotes, presses Send
  twice. One `Idempotency-Key` per draft is reused, so the second press is ignored while the first is pending.
- Visible: `Sending...`, then `Sent. Replies appear here.`; the conversation shows one message. The file announces
  `Uploading <picked name>...`, reads `uploading` then `attached` under the cleaned stored name, and announces
  `Attached <filename>.`. A reply from the developer appears within 5 seconds (1-second poll) without touching the draft, topic,
  files, focus, caret or the last announcement.
- Provider-recorded: Postgres has one `player` message, one waiting thread, a stored signature, bucket (`7 of 8`) and
  sanitiser verdict, and a link verdict within 5 seconds; MinIO has `attachments/gloamrunner/<attachment id>` holding the
  uploaded bytes only after MinIO confirms the size.
- Developer inbox: within 2 seconds the thread appears under Waiting, both counts update, focus stays on the row it was on,
  and `<player name> is waiting.` is announced.

### 2. The game server posts receipts and refunds (brief: Journeys 2)

- Start: the game server posts, signed with `v1=` HMAC-SHA256 over `<timestamp>.<raw body>`: a partial yen refund before its
  receipt, the receipts (`Lantern Pack` 499 USD, a yen bundle 1200 JPY), a second partial refund, and a redelivery of the first
  refund with a different amount.
- Visible: the thread shows `Purchase recorded: Lantern Pack, 4.99 USD`, `Purchase recorded: Ember Lantern Bundle, 1200 JPY`,
  `Refund recorded: <receipt id>, 400 JPY`; the yen purchase reads `partly refunded: 400 JPY` (the exact sum of the two accepted
  refunds). The redelivery answers 200 `duplicate` with the original message id and changes nothing.
- A replayed delivery (same nonce) answers 409 `nonce_seen`, is stored as one refused entry, `Refused game-server event:
  purchase.receipt`, its Tamperglass Signature line reads `signature refused: nonce already seen`, and the open workspace
  announces `Refused a game-server event for <player name>: nonce already seen.`.

### 3. The developer clears the waiting inbox (brief: Journeys 3)

- Start: Wren signs in; `/inbox` shows the first page of 25 Waiting rows and `Show more threads`. Switching to Answered, typing
  a search, reloading and Back each restore tab, search and rows from `?status=answered&q=<text>`.
- Keyboard only: N and P open the next and previous loaded thread, J and K step through messages while Tamperglass follows,
  R focuses the reply, C closes, T moves to the first Tamperglass line.
- The game-server record (`Game server record`) lists both receipts and the purchases read `on the game server`.
- The access token expired while typing: the first 401 triggers exactly one shared `POST /api/auth/refresh` (with the change
  token), the reply is retried once with the same key and stored once. If the refresh fails, the browser goes to `/signin` with
  `Your session ended. Sign in again.`, keeps the thread URL and the draft, and after signing in lands on the same URL with the
  draft restored; nothing is sent until the developer sends it.
- Closing an answered thread announces `Thread closed.`, opens the row below (or above, if last) with the query kept, and puts
  focus on its level 2 heading; the closed row stays with the word `closed`. The reply appears in Ashveil's widget within 5 s.

### 4. A hostile message arrives (brief: Journeys 4)

- Tallow's message holds a script tag, a script link and a metadata address. The thread shows it as harmless words
  (`free skins here alert('gotcha') [claim now] http://169.254.169.254/latest/meta-data/`, the link rendered as an allowed
  `http` address only). Tamperglass shows `3 removed`, the before text with `<script>`, `</script>` and `(javascript:alert(1))`
  struck through, the after text, and the Link line `refused: metadata`. No preview is fetched and the local listener is never hit.

### 5. A player floods the widget (brief: Journeys 5)

- Eight sends in quick succession drain the 8-token bucket (one token refills every 15 seconds, held in Postgres). After the
  successful eighth send the widget asks `me`, shows and announces `You're writing faster than the inbox can read. Try again in
  <n> seconds.` and `Send` gets `aria-disabled="true"` (pressing it sends nothing). A reload shows the notice again from
  `me`; the device clock is never used. After `<n>` seconds (a page timer) the widget asks `me` again and, when a token is back,
  announces `You can write again.`. Each message's Bucket line shows the bucket draining. Another player is not slowed.

### 6. The game server is slow or down (brief: Journeys 6)

- Opening a purchase thread asks the game server afresh (`Asking the game server...`); pressing N before the answer discards
  the late answer for the earlier thread. On a failing lookup the status `Game server` reads `The game server isn't answering
  receipt lookups right now. Signed receipts in this thread are still checked.`, the purchases still render without comparison
  words, and the reply form still works. When the game server returns, `Look up receipts again` fills the record without a restart.

### 7. The developer changes a moderator's rules (brief: Journeys 7)

- Juno is on Tallow's thread; Wren adds `deny read on other threads`. The hub reloads Juno's rules and, within 2 seconds, Juno's
  workspace leaves for `/inbox` (query kept) announcing `That thread is no longer available.`; Tallow's row and the counts drop it;
  Juno's stream never carries Tallow's id, player id or text afterwards. Revoking the rule returns the row within 2 seconds.
  Juno never sees purchase threads or any receipt data (rule 5 deny receipts, rule 6 deny read on purchase).

### 8. Working on a phone (brief: Journeys 8)

- At 375 by 812: `Threads` opens the drawer (`dialog "Threads"`, focus on its first control, Tab wraps, Escape or the scrim
  closes, focus returns to the opener); choosing a thread closes it and focuses the heading; `Open Tamperglass` opens the sheet;
  Escape closes it and focus returns to `Open Tamperglass`. J K N P R C do nothing while an overlay is open; T closes the sheet.
  The closed drawer and sheet are not rendered, so they are out of the tab order and the accessibility tree.

## Palette (brief: Visual design, Colour; hex decided)

| Role | Hex | Contrast |
|---|---|---|
| ground (pale warm stone grey) | `#E8E5DE` | ink on ground 12.56 |
| surface (one shade darker) | `#DAD6CC` | ink on surface 10.89 |
| ink (near-black, olive-brown cast) | `#23231C` | |
| muted (warm mid-grey) | `#5A564C` | on ground 5.82, on surface 5.04 |
| accent (blueprint blue) | `#1B46C9` | white on accent 7.59 |
| on-accent | `#FFFFFF` | |

Accent appears on exactly one element per screen: Open the inbox (public), Sign in, Send reply (a focused Tamperglass line takes
the accent and Send reply drops to ink), Add rule, Send (ink while disabled), Back to the inbox (brief: Accent rule).

## Type (brief: Type)

EB Garamond (self-hosted latin woff2, weights 400 and 600, normal and italic) for display and body; body 19px / 1.6 (decided: a
little larger than usual), caption 16px; headings each a quarter larger: h4 23.75, h3 29.7, h2 37.1, h1 46.4px; the hero
title italic and sized so it ends before the slab starts (up to 4rem); counts, bucket levels, amounts and timestamps use `tabular-nums`; hostile text is italic
EB Garamond on the surface tone, never monospace; inline code is 0.92em on the surface tone.

## Space and layout (brief: Screens and layout)

| Viewport | Layout |
|---|---|
| 1280 by 800 | public column left edge 22vw (281.6px), 520px wide; workspace three panes: list left of the edge, thread at 22vw and 520px wide, Tamperglass fills the rest to a 24px margin |
| 768 by 1024 | public column left edge 22vw (169px), right margin 79px; workspace thread (left edge 24px, 400px) plus Tamperglass (to a 24px margin, about 296px); `Threads` opens the drawer |
| 375 by 812 | left edge 16px, columns 343px; slab shrinks and runs off the right edge; workspace thread alone, `Threads` drawer and `Open Tamperglass` sheet; widget fills the width inside 16px margins with 44px targets |

Hero (brief: Composition and hero): the surface panel is inset 12px on each side and ends at 44vh; the slab is translucent accent blue at 0.75 to 0.8 opacity, a little darker above the seam so the seam shows through (a soft diagonal sheen, white engraving; decided: white on the blend stays above 4.5:1) at 62vw, straddling the seam and running off the right edge, engraved with `i never got the lantern
pack` and `signature valid`, `7 of 8`, `nothing removed`, `no link`; the two-line italic h1 has its first baseline on the seam,
the second line muted; the sentence `Answer your players from inside the game, with every purchase, match and pasted link checked
before you read it.` sits about 120px lower, with the accent button `Open the inbox` below it.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Tamperglass verdict (opacity, translateY 4px to 0) | a stage arrives | 167ms | `cubic-bezier(0.16, 1, 0.3, 1)` | none: switches at once |
| Bucket meter fill (width) and count steps | Bucket stage arrives | 250ms | same | jumps to the level |
| Threads drawer (transform from the left) and Tamperglass sheet (from the bottom), scrim opacity | open or close | 250ms | same | no sliding; unmounted at once |
| Buttons (background-color), links (text-decoration-color) | press, hover | 80ms | linear | none |
| Live rows, hero slab | live update, load | none | n/a | n/a |

`checking` is static text; nothing loops (decided: the brief says never pulses, spins or loops).

## States per async action (brief: Feedback states)

Sign in: `Signing in...` / field errors (`Enter your email.`, `Enter your password.`, error summary with links) /
`That email and password don't match.` / `Your session ended. Sign in again.` / `You're signed out.` Open thread: `Opening
thread...`. Show more threads: `Loading more threads...`, `Showing <n> threads.`, `More threads didn't load. Try again.`.
Reply: `Sending reply...`, `Reply sent to <player name>.`, `Write a reply before sending.`, the closed-thread copy,
`Reply not sent. Try again.`. Close: `Closing thread...`, `Thread closed.`, `Answer the player before closing.`, `This thread is
already closed.`. Lookup: `Asking the game server...`, the empty and outage copy. Tamperglass: `Checked: ...;` once all four lines
settle. Rules: `Adding rule...`, `Rule added.`, `Rule not saved. Try again.`, `Revoking rule...`, `Rule revoked.`, `Rule not
revoked. Try again.`. Widget: `Sending...`, `Sent. Replies appear here.`, the rate-limit notice, `You can write again.`,
`Uploading <picked name>...`, `Attached <filename>.`, `<filename> didn't upload. Send it again later.`, the file field errors and
the identity copy. Announcements stay until the next one in the same region replaces them.

## Decisions where the brief is silent

| Value | Why |
|---|---|
| Event message `created_at` is the receipt time | decided: keeps the thread in time order whatever `occurred_at` claims |
| Widget polls the thread once a second | decided: replies must arrive within 5 seconds and the brief has no widget stream |
| Workspace never polls | brief: Expired session ("makes no requests besides its open live stream") |
| Stream frames carry only the thread id and a reason; the browser re-reads | decided: nothing about a hidden thread can leak, and the hub does no per-stream database work |
| A forensics stream reads the stored verdicts once when it opens; the link line that settles later reaches every open forensics stream for that message from the hub, with no further read | brief: Engineering standards (live updates fan out from one shared source) |
| Purchases and the game-server record are laid out as a grid (receipt id, item, right-aligned amount) with the refund or status words and comparison words on a caption line beneath | decided: tabular amounts line up as a forensic record (brief: Type, figures of equal width) |
| Change token also kept in `sessionStorage` | decided: a reload in the same tab can still make the one refresh |
| Seeded player display names (Ashveil, Mothwing, Kestrel, Tallow, Otter) | brief: Seed data |
| The workspace shows Purchases and Game server record until the receipt lookup answers 403 for the open thread | decided: the server's `receipts` decision is the only one; the browser never re-decides it |
| In the widget Send stays focusable with `aria-disabled="true"` whenever the bucket is empty (the notice shows); pressing it sends nothing and keeps the notice | brief: Public screens and controls (Widget Send row) |
| Thread opens clear the `Opening thread...` copy once the thread is shown | decided: a pending copy must not outlive its operation; every other copy stays until replaced (brief: Feedback states) |
| The link stage settles after the send answers for every player message (`no link` included) | brief: Verdicts (the link stage settles within 5 seconds of receipt) |

## Media and licences

No photograph, illustration or icon set. The hero slab is drawn from SVG shapes (original). `public/icon.svg` is drawn for this
app (original). Fonts: EB Garamond latin 400 and 600, normal and italic, from `@fontsource/eb-garamond` 5.3.0, OFL-1.1, listed in
`assets.json` and `THIRD_PARTY_NOTICES.md` with the full OFL text.
