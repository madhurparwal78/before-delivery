# Brightmoss Works Phosphene Yard

Phosphene Yard is a studio and marketplace for independent generative and motion artists. A creator describes a piece, tunes and keyframes it on a live canvas, and sells it as a run of numbered editions. A collector picks one edition number by looking at it, pays once, and gets a numbered VAT invoice and the paid export. A remixer is a creator who resells a variant of someone else's piece, and the original creator's royalty is taken automatically. The founder-operator runs the platform: plans, credit packs, refunds, ledgers and outages. The product uses these backends and no others: Postgres is the system of record. Keycloak handles sign-in and roles. Kill Bill handles subscriptions, purchases, payments and refunds. MinIO stores files. RabbitMQ carries render jobs. WireMock plays the AI and render provider. Mailpit receives all email. Gotenberg renders PDFs. Out of scope: crypto minting, wallets, on-chain anything, card forms (Kill Bill's built-in external payment method stands in for the card network), currencies other than USD, B2B reverse-charge invoicing, payouts to bank accounts (a statement records what is owed), and VAT invoices for plans and credit packs (Kill Bill's own invoices cover those).

## Problem and users

Independent shader and creative-coding artists, and VJs, build live real-time pieces in one tool and sell them somewhere else: a mint, a file shop or a membership tier. Off-chain, nothing numbers an edition, stops two buyers from both getting "7 of 50", or pays the original artist when someone resells a remix. Editions, royalties and remix credit end up in a spreadsheet. EU buyers of digital services need a sequentially numbered VAT invoice from the seller. Render providers time out partway through a job and still bill for it. The solo founder running a small platform for these artists pays for every gap. They refund double charges by hand, rebuild split statements from payment exports, re-send lost receipts and absorb render credits burned on failed jobs. Phosphene Yard brings this into one product, and it records each money state only after the provider confirms it.

- **Creator** (daily): describes a piece, tunes it on the instrument panel, keys it on the timeline, renders exports and publishes the piece as a numbered edition run that earns exact payouts.
- **Collector** (weekly): browses the gallery, chooses a specific edition number through the Edition Lens, pays once, and downloads the invoice and the paid export.
- **Remixer** (weekly): a creator who remixes another creator's published piece and sells the remix's own editions, with the original creator's royalty taken automatically. There is no separate remixer role.
- **Founder-operator** (daily): runs plans, credit packs and refunds, checks that the credit and split ledgers balance, and keeps sales honest while a provider is down.

## Journeys

1. **Describe to draft.** Ilse Marrow (creator, signed in) starts on the landing page. Ilse types a description into the describe-a-piece prompt bar and submits it. The assistant render-status pixel panel flickers while the provider drafts. Ilse lands in the editor on a new draft whose canvas is running, tunes the instrument panel faders and saves. The end state is a draft piece at version 2 in Ilse's studio list.
2. **Keyframe and render.** Ilse opens the draft "Night Loom". Ilse adds and moves keyframes on the keyframe timeline and export panel using only the keyboard, then presses Save, which stores the edits as version 2. Ilse then picks 9:16, 720p and 10 seconds and presses the render button. The render status region announces queued, rendering and ready. The end state is a ready export, a balance 10 credits lower, and a render-ready email in the inbox.
3. **Publish a run.** Ilse publishes the draft as 30 numbered editions at $15.00 using the ready export. The end state is the piece's live card in the gallery's "Fresh runs" section.
4. **Choose, hold and pay.** Pax Ferreira (collector, signed in) opens "Salt Halo" in the gallery. Pax moves the Edition Lens with the arrow keys to edition 6 and presses Enter. The checkout sheet slides in with a server countdown. Pax picks Sweden as the billing country and pays. The end state is the confirmed-payment announcement, a receipt with the invoice PDF in the inbox, and edition 6 in Pax's library with its downloads.
5. **Remix and split.** Tobi Ansel (creator) remixes "Tidewire Bloom", renders, and publishes the remix. When June Halloway buys an edition, the founder sees three split rows (Ilse's royalty, Tobi's share, the platform fee) that add up to the net price. Ilse's running statement shows the royalty line with no buyer details.
6. **Refund.** Wren Okafor (founder-operator) opens a receipted order in the console and refunds part of it. The end state is a numbered credit note, reversing split rows, a refund notice email, and the remaining refundable amount shown on the order.
7. **Plans and ledgers.** Odile Renn (creator with no credits) chooses the Studio plan on the plan and credit list. Odile's plan shows active and credits appear only after Kill Bill confirms the payment. Odile then cancels at end of term and sees the end date Kill Bill reports. In the console, Wren's credit ledger shows every account's balance equal to the sum of its rows.
8. **Through an outage.** With Gotenberg down, June buys an edition. The checkout shows "Paid, invoice pending" with the invoice number, and the founder console shows the invoice-rendering outage banner.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check.** `/app/run.json` installs, builds and serves the app on port 4173 (or `APP_PUBLIC_PORT`), and `GET /api/health` answers 200 `{"status":"ok"}`.
- **DP-02 — Keycloak sign-in and roles.** Every account signs in through Keycloak, and the creator, collector and founder-operator roles gate each action as listed in API.
- **DP-03 — One error shape and precedence.** Every API error uses the single error body and the single precedence order from API.
- **DP-04 — Same-origin server boundary.** The server enforces the body limits, content types and never-served list from Server boundary, and keeps serving when a dependency is down.
- **DP-05 — Configuration from the environment.** Every service URL, credential and timer is read from the environment variables in Configuration and secrets, and none reaches the browser.
- **DP-06 — Featured edition stage.** The landing page opens on the featured edition stage, five-verb workflow stack, describe-a-piece prompt bar and featured piece strip arranged as in Visual design.
- **DP-07 — Five-verb workflow stack.** The five verbs show one filled active verb that advances on a timer, pauses off-screen and holds still under reduced motion, as in Motion and effects.
- **DP-08 — Nocturnal working screens.** Gallery, editor, library and console screens carry the near-black ground, single yellow accent, type pairing, corner rules, tables and empty and error states of Visual design.
- **DP-09 — Reduced motion and still canvases.** With reduced motion every canvas shows one still frame, entrances appear in place and loops stop while every control keeps working, and without WebGL each canvas shows its still fallback.
- **DP-10 — Published viewports without overflow.** At 375x812, 768x1024 and 1280x800 every screen shows the layout from Screens and layout with no horizontal page scroll and touch targets at least 44 px.
- **DP-11 — Studio header.** The studio header stays at the top of every screen, gains its dark glass fill after scrolling past the hero, and collapses to one menu button below 768 px.
- **DP-12 — Describe a piece from a prompt.** Submitting the describe-a-piece prompt bar asks the AI provider for a shader graph and opens a new draft piece in the editor with the provider's shader and faders.
- **DP-13 — Assistant render-status pixel panel.** The assistant render-status pixel panel shows its idle, drafting, rendering and error states and flickers single cells only while work is pending.
- **DP-14 — Instrument panel faders.** Each uniform of a piece is a fader on the instrument panel that changes the live canvas at once and is saved with the piece.
- **DP-15 — Versioned saves reject stale edits.** Saving a piece requires its current version, and a save over a newer version is refused with 412 and the conflict copy.
- **DP-16 — Editor layout at published breakpoints.** The editor shows its three zones side by side from 1280 px and stacked from 768 px, and below 768 px it turns the timeline into a stacked track list.
- **DP-17 — Keyframe timeline and export panel.** The keyframe timeline and export panel shows layers, diamond keyframes, the easing editor, the audio waveform and the export choices, and stores uploaded assets in MinIO.
- **DP-18 — Keyboard keyframe editing.** A creator adds, moves, re-eases and deletes keyframes from the keyboard, and each change is announced in the studio status region.
- **DP-19 — Timeline under reduced motion.** With reduced motion the editor canvas shows the still frame at the playhead, and scrubbing, keyframe editing and rendering work unchanged.
- **DP-20 — Render cost reserved at accept.** Accepting a render reserves its credit cost from the creator's balance, or refuses it with 402 when the balance is short.
- **DP-21 — Render submit replays.** A render submitted again with the same idempotency key returns the first render and reserves nothing more, and the same key with a different body answers 409.
- **DP-22 — Ready only after stored and checksummed.** A render shows ready only after its export is stored in MinIO with a matching SHA-256, and then it captures its credits once and sends the render-ready email once, even if the job is delivered twice.
- **DP-23 — Render status announcements.** Each render state change is announced in the render status region with the exact copy from Feedback states.
- **DP-24 — Render-to-ready journey.** A creator renders an export of a draft piece and watches it move from queued to ready, with the balance, the stored file and the email all matching.
- **DP-25 — Provider timeouts and retries.** A render provider call that errors or exceeds the provider timeout is retried with backoff for at most three attempts, and then the job is dead-lettered.
- **DP-26 — Failed and cancelled renders return credits.** A render that fails, times out, is dead-lettered, returns a malformed file or is cancelled while queued releases its reserved credits exactly once.
- **DP-27 — Shader assistant outage.** When the AI provider is unreachable or answers badly, describing a piece answers 503 or 502 with the outage copy, keeps the prompt and creates no piece.
- **DP-28 — Publish a numbered edition run.** A creator publishes a draft with a ready export as a run of 1 to 500 numbered editions at a fixed price, and illegal transitions are refused.
- **DP-29 — Withdraw keeps owners' downloads.** Withdrawing a published piece removes it from the gallery and frees open holds, while every owner keeps their export and invoice downloads.
- **DP-30 — Live gallery and carousels.** The gallery shows the featured run and live piece cards in three, two or one-and-a-peek columns at the published breakpoints, with swipeable carousels and the show-more pill with count.
- **DP-31 — Gallery empty states.** Empty gallery sections, an empty studio and an empty library show the exact empty copy and one next-action button.
- **DP-32 — Public pages hide buyer data.** Gallery pages, piece pages and their API answers never include any collector's email, billing country or invoice number.
- **DP-33 — Edition Lens.** On the featured edition stage and the piece page the lens maps pointer position to edition N, renders N's seed variation inside the lens, shows the numeral and status caption, and sets `?edition=N`.
- **DP-34 — Lens by keyboard and touch.** The lens is a slider that steps with the arrow, Page, Home and End keys and follows a touch drag, and Enter or a click asks for a hold.
- **DP-35 — Server-timed edition hold.** A hold reserves edition N for one collector for the server-timed hold period (10 minutes by default), survives a reload with its remaining time, and frees N when it expires.
- **DP-36 — One winner per edition number.** When collectors claim the same edition number at once, exactly one gets the hold and every other gets 409 with the nearest free number, which their lens moves to.
- **DP-37 — Hold announcements.** Hold granted, minute countdown, expiry and number-taken events are announced in the checkout status region with the exact copy.
- **DP-38 — Keyboard checkout sheet.** The checkout sheet opens as a dialog that keeps Tab and Shift+Tab inside, closes on Escape and returns focus to the lens.
- **DP-39 — Buy charges through Kill Bill.** Buying a held edition creates a Kill Bill invoice and payment for the gross price on the collector's account and moves the order to paying, or answers 503 while Kill Bill is down.
- **DP-40 — Buy replays.** A Buy repeated with the same idempotency key returns the first order and creates no second Kill Bill charge.
- **DP-41 — Paid only on Kill Bill confirmation.** An order becomes paid only when Kill Bill confirms its payment, and the edition assignment, split rows and invoice number are then written together.
- **DP-42 — Verified once-only payment callbacks.** Payment callbacks without the tenant token are refused with 401, and forged, replayed or out-of-order events change nothing beyond what the Kill Bill API confirms.
- **DP-43 — Lens-to-paid journey.** A collector picks an edition with the keyboard, holds it, checks out, and sees the payment confirmed, the receipt in the inbox and the edition in the library.
- **DP-44 — Gapless invoice numbers.** Each confirmed order gets the next number in a gapless per-year sequence, assigned once and never changed or reused.
- **DP-45 — VAT by billing country.** The invoice's VAT rate comes from the buyer's billing country through the published rate table, and unsupported countries are refused at checkout.
- **DP-46 — Invoice PDF and receipt email.** Each paid order gets a Gotenberg-rendered invoice PDF in MinIO and one receipt email with the PDF attached, and only then shows receipted.
- **DP-47 — Invoice pending during a rendering outage.** When Gotenberg is down, a paid order shows "Paid, invoice pending" with its invoice number, the receipt waits, and retries keep the same number.
- **DP-48 — Mail outbox sends once.** When mail is down, receipts, render-ready emails, refund notices and statements wait in the outbox, and each is sent exactly once when an instance that can reach mail serves the same database, as qualified in Business rules.
- **DP-49 — Collector library.** The library lists the signed-in collector's orders with edition, state and download actions, newest first.
- **DP-50 — Owner-only short-lived downloads.** Export and invoice downloads issue a fresh short-lived link only to the order's owner, and every other user gets the same 404 as for a missing order.
- **DP-51 — Remix a published piece.** A creator remixes another creator's published piece into a new draft that credits the original, and the remix publishes its own edition run.
- **DP-52 — Exact sale split.** Each sale's net price is split into creator, remixer and platform rows by the published rule, and the rows always sum to the net price.
- **DP-53 — Royalty statement without buyer data.** A creator's running and closed statements list sales and royalties without any buyer email, billing country or invoice number.
- **DP-54 — Refunds with credit notes.** A founder-operator refunds a receipted order in full or in part within the refund window through Kill Bill, issuing a numbered credit note PDF and a refund notice.
- **DP-55 — Refund reverses the split.** Each refund writes reversing split rows computed by the same rule, and a full refund reverses every party's share to the cent.
- **DP-56 — Plans and credit packs.** Creators choose the Studio or Pro plan or buy a credit pack through Kill Bill on the plan and credit list, and credits are granted only when Kill Bill confirms the payment.
- **DP-57 — End-of-term cancel uses Kill Bill dates.** Cancelling a confirmed plan ends it at Kill Bill's charged-through date, shown as the plan's end date, and a plan still awaiting confirmation cannot be cancelled.
- **DP-58 — Balanced credit ledger.** Every credit movement is a balanced pair of ledger rows, and each account's balance always equals the sum of its rows.
- **DP-59 — Monthly payout statements.** Closing an ended month renders each creator's payout statement PDF, stores it in MinIO and emails it once.
- **DP-60 — Founder outage banners.** The founder console shows the exact outage banner for each unreachable service and clears it once the service answers.

## Frontend

### Screens and layout (DP-06, DP-08, DP-10, DP-11, DP-16, DP-30, DP-49)

Three published viewports apply to every screen: phone 375x812 (any width below 768 px), tablet 768x1024 (768 to 1279 px, with 768 itself counting as tablet), and desktop 1280x800 (1280 px and wider, with 1280 itself counting as desktop). No other breakpoint may change which layout a published viewport gets. No screen scrolls horizontally at any of the three sizes. Content sits inside a 32 px side margin on desktop and tablet and a 20 px margin on phones, on a 12-column grid.

- **Landing (`/`).** The studio header sits on top. Below it, the featured edition stage fills the first screen edge to edge. The five-verb workflow stack is on the left. The describe-a-piece prompt bar sits under the stack at the bottom left. The edition numeral and its caption are top centre, and the featured piece strip is bottom right, aligned with the prompt bar. Below the first screen come three numbered sections. Each opens with a section eyebrow and a split section intro: a two-line display headline in columns 1 to 7, and on the right, from about three quarters of the width, a short muted paragraph and an arrow link, bottom-aligned to the headline. The sections are:
  - `01 Gallery`: headline `Pieces that keep running.`, arrow link "Browse the gallery", then a row of three live piece cards.
  - `02 Studio`: headline `Tune it by hand.`, with the assistant render-status pixel panel on the left and the plan and credit list on the right.
  - `03 Editions`: headline `Every number is its own frame.`, arrow link "How editions settle".

  The page ends with the start-a-piece closing band. Tablet keeps the same order with the split intro stacked (headline, then paragraph and link). The phone layout shrinks the verb stack, makes the prompt bar full width, wraps the featured piece strip to two lines, and stacks every two-column split.
- **Gallery (`/gallery`, optional `?creator=<username>`).** The featured run sits at the top: a wide live canvas with the piece title. Below it come two sections, "Fresh runs" (published pieces that are not remixes) and "Remixes". Each section shows live piece cards, newest first:
  - Desktop: 3 columns, 6 cards shown.
  - Tablet: 2 columns, 4 cards shown.
  - Phones: a horizontal snap carousel of 6 cards, where each card takes about 85% of the width and the next card peeks in.

  The show-more pill with count sits centred under a section only when that section has more pieces than the cards shown. Its counter reads `<shown> of <total>`. Pressing the pill shows every piece of that section in the same layout (more rows, or a longer carousel on phones). It then removes the pill and its counter and moves focus to the heading of the first newly shown card. The `creator` filter limits both sections and the featured run to that creator's pieces.
- **Piece page (`/pieces/<slug>`, optional `?edition=N`).** The desktop layout has the live canvas with the Edition Lens in columns 1 to 8. Columns 9 to 12 hold the title, creator, remix credit when there is one, the price line, the editions-left line, the seed hash of the lens's current edition, and the "Remix" button for creators. Tablet and phone put the canvas full width on top with the details below. The checkout sheet enters from the right edge on desktop and tablet at about 40% of the width (at least 400 px). On phones it rises from the bottom at full width.
- **Studio (`/studio`).** This is the creator's list of their pieces (title, state, version, editions sold), their credit balance (available and reserved) and their plan, with the plan and credit list at `/studio/credits`. It is a table on desktop and tablet and stacked rows on phones.
- **Editor (`/studio/pieces/<slug>`).** It has three zones. On desktop, the live canvas takes columns 1 to 8 and the instrument panel of faders takes columns 9 to 12, both above the keyframe timeline and export panel, which spans the full width below. On tablet, the canvas is full width on top, then the instrument panel as a two-column grid of faders, then the timeline at full width. On phones, the canvas, the faders (one column) and the timeline come in that order, and the timeline becomes a stacked track list: one block per layer, each listing its keyframes as rows, with no horizontal lane. The validator console sits under the canvas on every size. A smaller assistant render-status pixel panel sits beside the render button in the render footer of the keyframe timeline and export panel.
- **Library (`/library`).** This is the collector's orders, newest first. Each row has a small live canvas of that edition's variation, the piece title, `Edition <N> of <M>`, the order state, the invoice number when there is one, and the "Download export" and "Download invoice" actions. It is a table on desktop and tablet and stacked cards on phones.
- **Console (`/console`, founder-operator only).** From top to bottom: the service notices region, then tabs "Orders", "Credit ledger", "Renders" and "Statements". Each tab is a plain table on desktop and tablet. On phones each table row becomes a stacked card with the label beside each value.

### Public screens and controls (DP-02, DP-06, DP-07, DP-11, DP-12, DP-13, DP-14, DP-17, DP-18, DP-30, DP-33, DP-34, DP-38, DP-49, DP-54, DP-56, DP-59, DP-60)

Only these roles and names are public; everything else is free. Copy for live regions is owned by Feedback states.

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Every screen | `banner` (studio header) | holds the links below |
| Header | `link "Phosphene Yard"` | wordmark, goes to `/` |
| Header | `navigation "Main"` with `link "Gallery"`, `link "Studio"` (creators), `link "Library"` (collectors), `link "Console"` (founder-operator) | |
| Header | `link "Sign in"` when signed out; `button "Account"` opening a menu with `menuitem "Sign out"` when signed in | |
| Header | `link "Start a piece"` | the next-action button |
| Header, phones | `button "Menu"` with `aria-expanded` | the single expander for the navigation |
| Landing | `list "Workflow"` with five `listitem`s | `Describe.` `Tune.` `Keyframe.` `Number.` `Settle.`; the active item carries `aria-current="step"` |
| Landing | `form "Describe a piece"` with `textbox "Describe a piece"` and `button "Describe"` | describe-a-piece prompt bar |
| Landing | `region "Now playing"` | featured piece strip: piece title, creator display name, engine tag `GLSL`, `<left> editions left`, and `link "Remix"` |
| Landing, gallery | `link "Browse the gallery"` | arrow link |
| Landing, editor | `img "Assistant status: <state>"` | assistant render-status pixel panel, `<state>` one of `idle`, `drafting`, `rendering`, `error`, set as in Feedback states |
| Landing bottom | `region "Start a piece"` with `link "Start a piece"` | start-a-piece closing band, headline `Start a piece tonight.` |
| Featured edition stage, piece page | `slider "Edition"` | Edition Lens; `aria-valuemin` 1, `aria-valuemax` M, `aria-valuenow` N, `aria-valuetext` `Edition <N> of <M>, <status>` |
| Featured edition stage, piece page | numeral and caption | numeral `<N>`, caption `of <M> · move to choose` before the first move, then `of <M> · <status>` with `<status>` one of `available`, `held`, `collected` |
| Featured edition stage, piece page | `status "Checkout status"` | polite live region |
| Gallery | `region "Fresh runs"`, `region "Remixes"` | sections |
| Gallery | `article` per live piece card, named by its `heading` (the piece title) | tag chip `GLSL` or `Remix`; caption `<creator> · <left> of <M> left` |
| Gallery | `button "Show all <section title>"` | show-more pill with count; counter text `<shown> of <total>` |
| Piece page | `button "Remix"` | creators only, not on their own piece |
| Checkout | `dialog "Checkout"` | sheet |
| Checkout | `textbox "Billing name"`, `textbox "Email"`, `combobox "Billing country"` | `Billing country` is a native drop-down. Its options, in order, are label (value): `United States` (`US`, selected by default), `United Kingdom` (`GB`), `Germany` (`DE`), `France` (`FR`), `Netherlands` (`NL`), `Ireland` (`IE`), `Sweden` (`SE`) and `Other country` (`OTHER`). The sheet prices `Other country` at 0% VAT, and the server refuses it with the unsupported-country field error. |
| Checkout | `button "Pay $<gross>"`, `button "Release hold"`, `button "Close checkout"` | |
| Checkout, after payment | `link "Open library"` | |
| Editor | `status "Studio status"` | polite live region |
| Editor | `status "Render status"` | polite live region |
| Editor | `slider "<uniform label>"` per fader | instrument panel |
| Editor | `button "Save"` | |
| Editor | `region "Validator"` | shader compile log |
| Editor | `region "Timeline"` | keyframe timeline and export panel |
| Timeline | `button "Select <label> layer"` with `aria-pressed` | one per layer |
| Timeline | `button "Keyframe <label> at <t> s"` | diamond keyframes, `<t>` with one decimal |
| Timeline | `slider "Playhead"` | 0 to the timeline duration in steps of 0.1 s |
| Timeline | `button "Play preview"` / `button "Pause preview"` | |
| Timeline | `radiogroup "Easing"` with radios `Linear`, `Ease in`, `Ease out`, `Ease in-out` | applies to the focused or last-selected keyframe |
| Timeline | `img "Audio waveform"` or the text `No audio stem.` | |
| Timeline | `button "Upload audio stem"`, `button "Upload font"`, `button "Upload model"` | |
| Timeline | `radiogroup "Aspect ratio"` (`16:9`, `9:16`, `1:1`, `4:5`), `radiogroup "Resolution"` (`720p`, `1080p`), `radiogroup "Format"` (`MP4`, `WebM`), `spinbutton "Duration (seconds)"` | export choices |
| Timeline | `button "Render <aspect> · <cost> credits"` | dimmed and disabled when the balance is short or there are unsaved changes |
| Timeline | `button "Cancel render"` | while a render is queued |
| Editor | `button "Publish"` opening `dialog "Publish edition run"` with `spinbutton "Editions"`, `textbox "Price (USD)"`, `combobox "Export"`, `button "Publish run"` | |
| Editor | `button "Withdraw"` | published pieces |
| Studio credits | `list "Plans and credits"` | plan and credit list; `button "Choose Studio"`, `button "Choose Pro"`, `button "Buy 500 credits"`, `button "Cancel plan"` |
| Library | `table "Your editions"` (phones: `list "Your editions"`) | `button "Download export"`, `button "Download invoice"` per order |
| Console | `region "Service notices"` | outage banners |
| Console | `tablist "Console"` with `tab "Orders"`, `tab "Credit ledger"`, `tab "Renders"`, `tab "Statements"` | |
| Console orders | `button "Refund"` per row, opening `dialog "Refund order"` with `textbox "Refund amount (USD)"` and `button "Issue refund"` | |
| Console statements | `button "Close <Month YYYY>"` | for example `Close October 2026` |
| Every page with work | `status` named as above | polite, never `alert` except the error summary |

### Interactions (DP-07, DP-11, DP-12, DP-14, DP-18, DP-30, DP-33, DP-34, DP-35, DP-38, DP-43, DP-49, DP-54)

- **Header.** The header stays fixed at the top. On phones, "Menu" toggles the navigation panel. Escape closes the panel and returns focus to "Menu".
- **Prompt bar.** The placeholder types out the example prompt `Oil-slick ripples that thicken toward the bottom edge, slow tide, warm rim light` one character at a time. It stops for good the moment the field gets focus or text. Enter or "Describe" submits. A signed-out user goes through Keycloak sign-in and comes back to submit the kept prompt. The editor opens on the new draft.
- **Faders.** Dragging a fader, or pressing the arrow keys on it (one hundredth of its range per step, one tenth with Page keys), changes the live canvas in the same frame. "Save" stores every fader value and the timeline with the piece. Fader and keyframe changes never save on their own.
- **Timeline keyboard.** Tab reaches the layer buttons, then the keyframes of the selected layer (one tab stop per layer, with the arrow keys moving focus between keyframes), then the playhead, the easing radios and the export choices.
  - On a focused keyframe, Left and Right move it by 0.1 s, and Shift+Left and Shift+Right move it by 1 s, clamped to the timeline.
  - Delete or Backspace removes the keyframe. Focus moves to the next keyframe, or to the layer button when none is left.
  - Pressing `K` while focus is anywhere inside the timeline region adds a keyframe on the selected layer at the playhead, with the fader's current value.
  - A move onto a time where the layer already has a keyframe is refused and announced.
  - The pointer can drag the same diamonds along the lane.
- **Edition Lens (pointer).** Moving the pointer over the stage moves the lens, and N follows the pointer's horizontal position: the left edge is 1, the right edge is M, and the positions in between are evenly spaced and rounded to the nearest number. The URL changes to `?edition=N` without adding history entries. Clicking asks the server for a hold on N (signed-out users go through sign-in first and return to `?edition=N`).
- **Edition Lens (keyboard).** The lens is the `slider "Edition"`. Left and Right (and Down and Up) step ±1, Page Down and Page Up step ±10, and Home and End go to 1 and M, all clamped. Enter asks for a hold.
- **Edition Lens (touch).** Dragging a finger moves the lens and N in the same way. Lifting the finger keeps N. A tap asks for a hold. The gallery carousels swipe sideways and snap card by card.
- **Hold and checkout.** When the hold is granted, the lens locks on N, the numeral stops following the pointer, and the checkout sheet opens with focus on "Billing name".
  - Inside the sheet, Tab past the last control wraps to the first, and Shift+Tab from the first wraps to the last.
  - Escape or "Close checkout" closes the sheet, keeps the hold, and returns focus to the lens. Enter on the lens reopens the sheet while the hold lasts.
  - "Release hold" ends the hold, closes the sheet and returns focus to the lens.
  - Changing the billing country recomputes the VAT and total lines in the sheet at once from the published rate table.
  - "Pay $<gross>" submits once. The button is disabled while the request is in flight. Its idempotency key follows the browser key rule in Business rules.
- **Reloading a held piece page.** The lens locks on the held number and reopens the sheet with the server's remaining time.
- **Library.** "Download export" and "Download invoice" each request a fresh link and start the download in the same tab.
- **Console refund.** "Refund" opens the dialog. The amount field is prefilled with the remaining refundable net amount. "Issue refund" submits with a key chosen by the browser key rule in Business rules. The dialog follows the same focus rules as the checkout sheet.
- **Hover and press.** Links and buttons brighten on hover in about a sixth of a second. Arrows in the arrow links and the next-action button nudge right on hover. Buttons scale down very slightly while pressed. Focus shows as a two-pixel yellow ring.

### Visual design (DP-06, DP-08, DP-30)

The direction is **seed**: a nocturnal, decisive, alive studio.

- **Palette, in words.** The ground is a near-black, edge to edge behind every live canvas. Cards, panels and inputs sit on a slightly lifted charcoal surface with dark-grey one-pixel borders. The main text is a warm off-white ink, and secondary text is a muted warm grey. There is a single acid-yellow accent, with near-black labels on yellow. Yellow marks only the next action (the next-action button, the active verb's dot, the focused or claimable edition, the section numbers) and the active edition. There is no violet or magenta glow anywhere. The featured piece's own colours light the hero.
- **Type.** Display headlines are set in Archivo at its extra-wide width and heaviest practical weight. They use sentence case, always end with a period, have very tight leading (lines nearly touching) and slightly tight tracking. The edition numeral is set in Unbounded, heavy. Body text is Hanken Grotesk in regular and medium, with tabular figures for every price, credit count and edition number. JetBrains Mono is used only for literal shader code, the validator console and edition seed hashes. Headings step up by a ratio of about 1.2 per level. Desktop display headlines are about five to seven times the body size, and phone headlines about three times. Fonts load from Google Fonts or from self-hosted copies of the same OFL fonts.
- **Density** is comfortable: generous section spacing, with rows in tables tall enough for a 44 px tap target.
- **Composition.** Sections run full bleed within the margins. A giant headline sits in columns 1 to 7, with the intro and an arrow link bottom-aligned on the right, and a live canvas behind or beside every headline.
- **Hero (featured edition stage).** The current featured run plays edge to edge as an original procedural thin-film field: oily interference bands that drift and thicken, coloured by the piece itself.
  - The five verbs stack on the left as giant outlined words. Only the active verb is filled in ink and followed by a small yellow dot.
  - The prompt bar is a charcoal, slightly translucent rounded bar with a leading yellow slash glyph and an inset yellow submit button.
  - The top-centre Unbounded numeral reads `14` at load, above the caption `of <M> · move to choose`.
  - The featured piece strip at the bottom right is one row of small Hanken Grotesk medium text: a short yellow progress dash, then the title, creator, engine, editions left and the Remix link.
- **Seed components, as named in this product.**
  - The **studio header** is transparent over the hero. After scrolling it becomes a dark translucent glass bar with a soft blur and a one-pixel bottom border. It holds the logo on the left, text links on the right, and the yellow **next-action button** last.
  - The **five-verb workflow stack**, **featured edition stage**, **describe-a-piece prompt bar** and **featured piece strip** are as above.
  - The **section eyebrow** is Hanken Grotesk medium text with a yellow two-digit number, then the section name in muted grey, sitting just above each headline.
  - The **split section intro** is the headline-left, text-right arrangement above. The **arrow link** is ink text with an arrow and a thin underline that turns full ink on hover.
  - The **plan and credit list** is rows divided by one-pixel borders. Each row has a display-face title, a muted description, a tabular price, and its action button.
  - The **assistant render-status pixel panel** is a square charcoal panel with its bottom-right corner cut off at 45°. It holds a 10×10 grid of square cells: two olive top rows, grey body cells, and two yellow 2×2 "eyes". A caption below reads `Assistant / <state>`.
  - The **live piece card** is a rounded card whose whole face is the running canvas. A dark scrim fades up from the bottom. A small dark tag chip sits top-left. The display-face title and caption sit at the bottom left.
  - The **show-more pill with count** is a ghost pill with a thin border, with the muted `<shown> of <total>` counter below it.
  - The **keyframe timeline and export panel** is a charcoal panel. It holds layer rows with diamond keyframes, the easing curve drawn as a small line graph, the audio waveform, a border line, and below it the export choices and the render button. The render button is the dimmed, half-strength yellow when it cannot run and full yellow when it can.
  - The **start-a-piece closing band** has a three-line headline whose last word `tonight.` is in yellow. A wide yellow diagonal stripe rises from the bottom right behind it, with a faint dark chevron shape of original design. A large next-action button and a muted note sit beside it.
- **Working screens.** These use the same ground, the charcoal surface and dark-grey one-pixel borders, with one corner rule: 10 px on cards and panels, 8 px on buttons and inputs, fully round only on pills. Ledger, sales, split and payout tables are plain rows with tabular figures, a display-face title in a small size, and money right-aligned in ink. Positive and negative amounts carry a written `+` or `−` sign and a word label (`credit`, `debit`, `refund`), never colour alone. Empty states use one large display sentence ending in a period and one yellow button. Error and outage states are a full-width charcoal banner with a yellow bar down its left edge and the published copy. Loading is the assistant render-status pixel panel flickering single cells.
- **Accessibility of the look.** All text meets WCAG 2.2 AA contrast against its background. Muted grey is used only at sizes and on backgrounds where it passes. Every interactive control is at least 44 by 44 px on touch layouts. Icons are Lucide outline icons with text labels or accessible names.

### Motion and effects (DP-07, DP-09, DP-13, DP-19, DP-30, DP-33, DP-34, DP-38)

Every motion means something: entering, changing state, showing progress, or answering a hover or press. No other looping decoration exists.

- **Live canvases.** Every piece canvas (hero, gallery cards, piece page, editor, library thumbnails) runs its shader in real time, changing every frame. A canvas pauses (its pixels stop changing) as soon as it is fully off-screen, and resumes when it scrolls back in. Without WebGL, the canvas shows a still Canvas 2D frame of the piece's colour field and the text `This piece plays live with WebGL. Showing a still frame.`
- **Hero entrance.** On load, the canvas fades in over about one second, and the verbs rise into place one after another, about a tenth of a second apart, each taking about one and a half seconds and settling softly.
- **Five-verb workflow stack.** The active verb advances to the next line every 3 seconds (2.5 to 3.5 seconds), wrapping from `Settle.` to `Describe.`. On each step, the outgoing verb fades to an outline and the incoming verb fills over about half a second, and the dot moves with it. The cycle stops while the hero is off-screen and keeps its current step.
- **Prompt bar typewriter.** The placeholder types at about 25 characters per second and stops on focus or input.
- **Scroll entrances.** Headlines, cards and list rows rise a short distance and fade in over about one and a half seconds the first time they enter the viewport. Siblings are about a tenth of a second apart, and each plays only once.
- **Hover.** Colour, border and background changes take about a sixth of a second. A card's canvas zooms in very slightly over about one and a half seconds.
- **Edition Lens (signature).**
  1. The lens is a circle 240 px across on viewports 768 px and wider, and 176 px across below 768 px. It follows the pointer with an eased lag that settles within about half a second.
  2. Inside the lens, the canvas renders edition N's seed variation over the base piece. The same N always looks the same.
  3. Each change of N makes the numeral jump to the new number and shrink from slightly larger back to its normal size in about a sixth of a second.
  4. The lens ring is filled yellow for available editions, outlined in ink for collected ones, and outlined in muted grey for editions held by someone else. Ring changes cross-fade over about half a second.
  5. When a hold is granted, the ring fills, the lens stops following the pointer, and the checkout sheet slides in within about half a second and settles softly.
  6. When the server gives the number to someone else, the ring cross-fades to an outline over about half a second, the announcement plays, and the lens glides to the nearest free number within about half a second.
- **Assistant render-status pixel panel.** It is still when idle. While drafting or rendering, one cell at a time changes shade every 100 to 200 milliseconds. In the error state, the eyes turn muted grey and stay still.
- **Status changes** (render state, order state) cross-fade their badge over about half a second.
- **Reduced motion** (when the system asks for it):
  - Every canvas shows one still frame (the base piece at time zero), and the lens shows a still frame of edition N.
  - The lens jumps straight to the pointer with no lag, the numeral changes with no scale, and the ring changes with no fade.
  - The checkout sheet appears in place.
  - All five verbs show at once with `Describe.` filled and no cycling.
  - Entrances appear in place, and the typewriter shows the full placeholder at once.
  - The pixel panel shows a fixed pattern per state.
  - The editor canvas shows the still frame at the playhead and updates only when the playhead or a fader moves. "Play preview" steps the playhead by 0.1 s each second instead of animating.
  - Arrow-key stepping, touch dragging, holds, the URL, faders, keyframe editing and rendering behave exactly as in full motion.

### Feedback states (DP-12, DP-13, DP-15, DP-18, DP-20, DP-23, DP-26, DP-27, DP-31, DP-36, DP-37, DP-39, DP-41, DP-45, DP-47, DP-50, DP-54, DP-56, DP-57, DP-60)

All copy below renders character for character, with straight apostrophes and quotes. Announcements go to the named polite live region, and the same text is visible on screen. Placeholders:
- `<N>` and `<M>` are the edition number and the run size.
- `<gross>` and similar money values are dollars with two decimals and thousands commas (for example `1,234.50`).
- `<cost>` and `<available>` are whole credits.
- `<t>` is seconds with one decimal.
- `<mm:ss>` is minutes and seconds.
- `<date>` is `YYYY-MM-DD`.

**Studio status (editor and prompt bar):**
- Describe pending: `Drafting your piece...` (the pixel panel shows drafting)
- Describe success: `Draft ready. Tune it on the instrument panel.`
- Prompt too short or too long: field error `Describe the piece in 3 to 500 characters.`
- AI provider down (503): `The shader assistant is offline. Your prompt is kept; try again in a minute.`
- AI provider answered badly (502): `The shader assistant sent something we can't run. Try a different prompt.`
- Collector without the creator role: `Only creator accounts can start pieces.`
- Save success: `Saved version <v>.`
- Save conflict (412): `This piece changed in another tab. Reload to see version <v>.` (`<v>` is the server's current version)
- Keyframe added: `<label> keyframe added at <t> s.` Moved: `<label> keyframe moved to <t> s.` Removed: `<label> keyframe removed.` Easing changed: `<label> keyframe easing set to <easing name>.` (`<easing name>` is the chosen radio's label exactly as shown, for example `Ease in-out`.) Blocked move: `<label> already has a keyframe at <t> s.`
- Asset uploaded: `<file name> uploaded.` Asset too large (413): `That file is over 20,000,000 bytes.`
- Publish success: `Published as <M> numbered editions.` Withdraw success: `Withdrawn. Owners keep their downloads.`
- Remix created: `Remix draft created from <source title>.`

**Render status:**
- While a render is unsettled, the editor re-reads it every 2 seconds. It announces each state in the render's `history` that it has not yet announced, in order. The states `accepted` and `stored` produce no announcement. Every other state is announced with the copy below.
- Insufficient credits (402): `This render needs <cost> credits; you have <available>.`
- Queued: `Render queued. <cost> credits reserved.`
- Rendering: `Rendering <aspect> <resolution> export.`
- Ready: `Export ready. <cost> credits used.`
- Failed (provider error, storage error or malformed file): `Render failed. Your credits are being returned.`
- Timed out: `Render timed out after 3 attempts.`
- Credits released after a failure (`failure_reason` is set and is not `cancelled`, so `history` holds `failed` or `timed_out` just before it): `<cost> credits returned to your balance.`
- Credits released with `failure_reason` `cancelled` (the history goes from `queued` straight to `credits_released`): two announcements in this order, `Render cancelled.` then `<cost> credits returned to your balance.`

**Checkout status (featured edition stage, piece page and checkout sheet):**
- Hold granted: `Edition <N> of <M> is held for you. <mm:ss> left.`
- Countdown, at each whole minute remaining and at 30 seconds: `<minutes> minutes left on edition <N>.` (or `30 seconds left on edition <N>.`; one minute reads `1 minute left on edition <N>.`). The visible countdown in the sheet reads `Held for <mm:ss>` and ticks every second.
- Hold expired: `Your hold on edition <N> expired.`
- Number taken (409): `Edition <N> was just taken. Showing edition <K>.` When nothing is free: `Every edition of this run is taken.`
- Billing country unsupported: field error `We can't invoice that country yet.` Email invalid: field error `Enter an email address.` Billing name empty: field error `Enter the name for the invoice.`
- Paying: `Payment sent. Waiting for Kill Bill to confirm.`
- Paid, invoiced and receipted: `Payment confirmed. Edition <N> of <M> is yours.`
- Paid while invoice rendering is down: `Paid, invoice pending. Invoice <invoice number> will be ready shortly.`
- Payment failed: `Payment failed. Edition <N> is released.`
- Kill Bill down (503): `Payments are offline right now. Your hold is kept until its timer runs out.`

**Library and downloads:**
- Storage down (503): `Downloads are paused while file storage is offline.`
- Invoice not rendered yet (409): `Paid, invoice pending. Invoice <invoice number> will be ready shortly.`

**Console:**
- Refund success: `Refund issued as <credit note number>.`
- Refund window passed (409): `Refunds close 30 days after payment.`
- Refund amount too large or too small (422): `Refund between $0.01 and $<remaining>.`
- Statement closed: `Statements for <Month YYYY> sent to <count> creators.` Month still open (409): `<Month YYYY> is still open.`

**Plans and credits (studio credits page):**
- Plan or pack pending: `Waiting for Kill Bill to confirm your payment.`
- Plan active: `Your <Plan> plan is active.` (`<Plan>` is `Studio` or `Pro`)
- Pack confirmed: `500 credits added.`
- Cancelled: `Your plan ends on <date>.`
- Cancel before confirmation (409): `Your plan can be cancelled once Kill Bill confirms it.`

**Assistant render-status pixel panel (`img "Assistant status: <state>"`):**
- On the landing page, the panel shows:
  - `drafting` while a describe request is in flight;
  - `error` after a 502 or 503 answer, until the next submit;
  - `idle` otherwise.
- In the editor, the panel shows:
  - `rendering` while the piece's most recent render is `accepted`, `queued`, `rendering` or `stored`;
  - `error` when that render's `history` contains `failed` or `timed_out` (equivalently, its `failure_reason` is set and is not `cancelled`), until the next render is accepted;
  - `idle` otherwise, including after a ready render and after a cancelled render.

  It changes in the same update as the render status region.

**Empty states (64 px-class display sentence plus one action).** Each action navigates, so its role is link, styled as the yellow next-action button:
- Gallery section with no pieces ("Fresh runs"): `Nothing numbered yet.` with `link "Start a piece"`.
- "Remixes" with no pieces: `No remixes yet.` with `link "Browse the gallery"`.
- Studio with no pieces: `No pieces yet.` with `link "Start a piece"`.
- Library with no orders: `No editions collected yet.` with `link "Browse the gallery"`.

**Outage banners (console `region "Service notices"`, one banner per unreachable service):**
- Kill Bill: `Kill Bill is unreachable. New purchases, refunds and plan changes are paused; held editions keep their timers.`
- AI and render provider: `The render provider is unreachable. New renders wait in the queue and return their credits if they run out of retries.`
- Gotenberg: `Invoice rendering is down. Paid orders keep their invoice numbers and show "Paid, invoice pending" until their PDFs render.`
- Mail: `Mail is down. Receipts and notices wait in the outbox and send once mail is back.`
- MinIO: `File storage is unreachable. Renders cannot finish and downloads are paused.`

**Error summary.** Any form with field errors shows an `alert` summary at its top that reads `Check <count> fields.` and contains links to each field, followed by inline field errors.

## Backend

### API (DP-01, DP-02, DP-03, DP-12, DP-15, DP-17, DP-20, DP-21, DP-26, DP-27, DP-28, DP-29, DP-30, DP-32, DP-33, DP-35, DP-36, DP-39, DP-40, DP-42, DP-49, DP-50, DP-51, DP-53, DP-54, DP-56, DP-57, DP-58, DP-59, DP-60)

**Conventions.**
- Request and response bodies are `application/json; charset=utf-8`, except asset uploads (`multipart/form-data`).
- Times are ISO 8601 UTC. Money is integer cents in USD.
- Authentication is the browser's Keycloak session cookie, or `Authorization: Bearer <access token>` issued by the realm in `KEYCLOAK_REALM` to the client `AUTH_CLIENT_ID`.
- Roles are the realm roles `creator`, `collector` and `founder-operator`. A remixer is a creator.

**Error body.** Every error has the same shape: `{"error":{"code":"<snake_case>","message":"<sentence>","fields":{"<field>":"<message>"}}}`. `fields` appears only on 422.

**Error precedence (one order for the whole API):**
1. 413 `payload_too_large`, then 415 `unsupported_media_type`.
2. 401 `unauthenticated`.
3. 404 `not_found` for an unknown id or another user's private resource. The body is identical in both cases: `{"error":{"code":"not_found","message":"Not found."}}`.
4. 403 `forbidden` (missing role).
5. Idempotency: a missing or invalid key gives 422 on field `Idempotency-Key`. A stored replay returns its stored response here, before any state check. A reused key with a different body gives 409 `idempotency_key_reused`. A key whose first request is still running gives 409 `idempotency_in_progress`.
6. 428 `version_required`, then 412 `version_conflict`.
7. 409 state conflicts.
8. 422 `validation_failed`.
9. 402 `insufficient_credits`.
10. 503 and 502 provider errors.

**Idempotency-Key header.** It holds 1 to 128 characters from letters, digits, `-` and `_`. It is required on the five endpoints marked **[idem]** below. Replays answer with the original status and body plus the header `Idempotent-Replayed: true`.

**Public and session:**
- `GET /api/health` → 200 `{"status":"ok"}` (no auth, never depends on providers).
- `GET /auth/login?return_to=<path>` → 302 to Keycloak (authorization code with PKCE). `GET /auth/callback` → 302 to `return_to`. `POST /auth/logout` → 204.
- `GET /api/me` → 200 `{"id","username","display_name","email","roles":[...]}`.
- `GET /api/gallery?creator=<username>` (no auth) → 200 `{"featured":<card>|null,"sections":[{"id":"runs","title":"Fresh runs","total":<int>,"pieces":[<card>...]},{"id":"remixes","title":"Remixes","total":<int>,"pieces":[...]}]}`. A card is `{"slug","title","creator_display_name","engine":"GLSL","edition_count","editions_left","price_cents","remix_of":null|{"slug","title","creator_display_name"},"published_at"}`, newest first. `editions_left` is the count of the run's numbers whose status is `available`; held and collected numbers are not counted. Piece bodies use the same definition.
- `GET /api/pieces/<slug>` → 200 piece. It is public for published pieces. Drafts are visible to their owner only, and withdrawn pieces to their owner and the founder-operator; anyone else gets 404. The `ETag` header is `"<version>"`. Piece body: `{"slug","title","state":"draft"|"published"|"withdrawn","version","engine":"GLSL","creator":{"id","display_name"},"fragment_source","uniforms":[{"name","label","min","max","value"}],"timeline":{"duration_s","tracks":[{"uniform","keyframes":[{"time_s","value","easing"}]}],"audio_asset_id":null|<id>},"assets":[{"id","kind","filename","bytes"}],"remix_of":null|{...},"edition_count":null|<int>,"price_cents":null|<int>,"editions_left":null|<int>,"export_render_id":null|<id>}`. `fragment_source` and `assets` appear only to the owner. Each keyframe's `easing` is one of `linear`, `ease-in`, `ease-out` and `ease-in-out`, matching the radios `Linear`, `Ease in`, `Ease out` and `Ease in-out`. Any other value answers 422.
- `GET /api/pieces/<slug>/editions` → 200 `{"edition_count":M,"editions":[{"number","status":"available"|"held"|"collected","held_by_you":bool,"seed_hash"}]}`. This list is the only edition data public pages use.

**Creator (`creator` role, own pieces only):**
- `POST /api/pieces/describe` `{"prompt":"<3 to 500 characters>"}` → 201 `{"piece":<piece>}` (draft, version 1). 503 `provider_unavailable`, 502 `provider_malformed`.
- `PUT /api/pieces/<slug>` with `If-Match: "<version>"`, body `{"title","uniforms":{"<name>":<number>},"timeline":{...}}` → 200 piece with the version increased by 1. Without If-Match: 428. Stale version: 412 `{"error":{"code":"version_conflict","message":"...","current_version":<int>}}`. Non-draft: 409 `invalid_transition`.
- `POST /api/pieces/<slug>/assets` multipart fields `kind` (`font`, `model` or `audio`) and `file` → 201 `{"asset":{"id","kind","filename","bytes"}}`. Extensions: font `.woff2` or `.ttf`, model `.glb`, audio `.wav` or `.mp3`. Anything else gives 422.
- `POST /api/pieces/<slug>/renders` **[idem]** `{"format":"mp4"|"webm","resolution":"720p"|"1080p","duration_s":<5..60>,"aspect":"16:9"|"9:16"|"1:1"|"4:5"}` → 202 `{"render":<render>}` in state `queued`. 402 `insufficient_credits` with `"needed":<int>,"available":<int>` inside `error`. Non-draft: 409 `invalid_transition`.
- `GET /api/pieces/<slug>/renders` → 200 `{"renders":[<render>...]}`. `GET /api/renders/<id>` → 200 render. Render body: `{"id","piece_slug","state","failure_reason":null|"provider_error"|"timeout"|"malformed"|"storage_error"|"cancelled","cost_credits","attempts","format","resolution","duration_s","aspect","sha256":null|"<hex>","history":[{"state","at"}],"created_at"}`.
- `POST /api/renders/<id>/cancel` → 200 render in `credits_released` with `failure_reason` `cancelled`. If the render is not queued: 409 `invalid_transition`.
- `POST /api/pieces/<slug>/publish` `{"edition_count":<1..500>,"price_cents":<100..500000>,"export_render_id":"<ready render of this piece>"}` → 200 piece. 409 `invalid_transition`.
- `POST /api/pieces/<slug>/withdraw` → 200 piece. 409 `invalid_transition`.
- `POST /api/pieces/<slug>/remix` (source owned by someone else) → 201 `{"piece":<draft>}`. 409 `own_piece`, 409 `remix_of_remix`.
- `GET /api/me/credits` → 200 `{"available","held","entries":[<entry>...]}` (this creator's entries).
- `GET /api/me/plan` → 200 `{"plan":null|{"code":"studio-monthly"|"pro-monthly","state":"pending_payment"|"active"|"cancelling"|"ended","ends_on":null|"<date>"}}`.
- `POST /api/me/plan` `{"plan":"studio-monthly"|"pro-monthly"}` → 202 plan in `pending_payment`. 409 `plan_exists` while a plan is pending, active or cancelling.
- `POST /api/me/plan/cancel` → 200 plan in `cancelling` with `ends_on`. 409 `plan_not_confirmed`. 409 `invalid_transition` when there is no active plan.
- `POST /api/me/credit-packs` **[idem]** `{"pack":"pack-500"}` → 202 `{"purchase":{"id","state":"paying","credits":500,"price_cents":1900}}`. `GET /api/me/credit-packs/<id>` → 200 purchase, with state `paying`, `paid` or `failed`.
- `GET /api/me/statements/<YYYY-MM>` → 200 `{"period","status":"open"|"closed","lines":[{"date","piece_title","edition","kind":"sale"|"remix_sale"|"royalty"|"refund","amount_cents"}],"total_cents"}`. No other line fields exist.

**Collector (`collector` role, own orders only):**
- `POST /api/pieces/<slug>/editions/<n>/holds` **[idem]** → 201 `{"order":<order>}` in state `held` with `expires_at` and `seconds_left`. If this collector already holds this same number: 200 with the existing order, expiry unchanged. Taken: 409 `{"error":{"code":"edition_taken","message":"...","next_free":<int>|null}}`. Own piece: 409 `own_piece`. Number outside 1..M, or piece not published: 404.
- `GET /api/orders/current?piece=<slug>` → 200 the caller's open order (held or paying) for that piece, or 404.
- `DELETE /api/orders/<id>/hold` → 200 order in `expired`. If not held: 409 `invalid_transition`.
- `POST /api/orders/<id>/buy` **[idem]** `{"billing_name":"<1..120>","email":"<address>","billing_country":"<ISO code>"}` → 202 order in `paying`. 409 `hold_expired`, 409 `invalid_transition`, 422 (`billing_country` unsupported, `email` invalid, `billing_name` empty), 503 `payments_unavailable`.
- `GET /api/orders/<id>` → 200 order (owner or founder-operator). Order body: `{"id","piece_slug","piece_title","edition","edition_count","state","expires_at":null|<time>,"seconds_left":null|<int>,"billing_name","email","billing_country","net_cents","vat_rate_percent","vat_cents","gross_cents","currency":"USD","invoice_number":null|"PY-YYYY-NNNNNN","invoice_status":"none"|"pending"|"ready","receipt_status":"none"|"queued"|"sent","refunded_net_cents","paid_at":null|<time>,"created_at"}`.
- `GET /api/me/orders` → 200 `{"orders":[<order>...]}`, newest first, every state except `expired`.
- `GET /api/orders/<id>/export` and `GET /api/orders/<id>/invoice` → 200 `{"url":"<presigned>","expires_in":<seconds>}`. Order not paid: 409 `invalid_transition`. PDF not ready: 409 `invoice_pending` with `invoice_number` inside `error`. Storage down: 503 `storage_unavailable`.

**Kill Bill callbacks (no session):**
- `POST /api/billing/killbill-events?token=<token>` with Kill Bill's push body `{"eventType","objectType","objectId","accountId","metaData"}` → 204 for any request carrying the right token, whether applied, duplicate or ignored. Missing or wrong token: 401 `unauthenticated`.

**Founder-operator (`founder-operator` role):**
- `GET /api/admin/orders?state=<state>` → 200 `{"orders":[<order>...]}`.
- `GET /api/admin/orders/<id>/splits` → 200 `{"net_cents","rows":[{"party":"creator"|"remixer"|"platform","holder":"<display name or Brightmoss Works>","kind":"sale"|"refund","amount_cents","refund_id":null|<id>}]}`.
- `POST /api/admin/orders/<id>/refunds` **[idem]** `{"net_cents":<1..remaining>,"reason":"<0..300>"}` → 201 `{"refund":{"id","credit_note_number","net_cents","vat_cents","gross_cents","rows":[<split row>...]}}`. 409 `invalid_transition` when not receipted, 409 `refund_window_closed`, 422 on `net_cents`, 503 `payments_unavailable`.
- `GET /api/admin/credit-ledger` → 200 `{"accounts":[{"account","balance"}],"entries":[{"id","kind":"grant"|"pack"|"reserve"|"capture"|"release","render_id":null|<id>,"created_at","rows":[{"account","amount"}]}]}`.
- `GET /api/admin/renders?state=<state>` → 200 `{"renders":[<render>...]}`.
- `POST /api/admin/statements` `{"period":"YYYY-MM"}` → 201 `{"period","creators":<count>}`. 409 `period_open`, 409 `period_closed`.
- `GET /api/admin/services` → 200 `{"services":[{"name":"killbill"|"render_provider"|"gotenberg"|"mail"|"storage","reachable":bool,"checked_at"}]}`.

### Business rules (DP-14, DP-15, DP-20, DP-21, DP-22, DP-25, DP-26, DP-28, DP-29, DP-33, DP-35, DP-36, DP-40, DP-41, DP-42, DP-44, DP-45, DP-46, DP-47, DP-48, DP-51, DP-52, DP-54, DP-55, DP-56, DP-57, DP-58, DP-59)

**Piece states.**
- `draft → published` (publish) and `published → withdrawn` (withdraw). No other move exists. Each illegal move answers 409 `invalid_transition`: publishing a published or withdrawn piece, withdrawing a draft or a withdrawn piece, and saving, rendering or uploading to a non-draft piece.
- Publishing needs a `ready` render of the same piece as `export_render_id`. A field error on `export_render_id` is 422.
- Withdrawing ends every `held` order on the piece (to `expired`) and removes the piece from the gallery and from public piece pages. Orders already paid keep their export and invoice downloads, library rows and refunds.
- A piece's `version` starts at 1 and increases by 1 on each successful save. A save must send the current version in `If-Match`.

**Remixes.**
- Remixing copies the source's shader, uniforms and timeline into a new draft owned by the remixer, titled `<source title> (remix)`, with `remix_of` set.
- A creator cannot remix their own piece (409 `own_piece`). A remix cannot be remixed (409 `remix_of_remix`). Only published sources can be remixed; anything else is 404.
- A remix publishes its own run like any piece.

**Edition seeds.**
- `seed_hash` for edition N is the first 16 lowercase hex characters of SHA-256 of the UTF-8 text `<slug>:<N>`.
- The shader receives `uSeed` = (the first 8 of those hex characters read as an unsigned integer) ÷ 4294967295.
- The base piece renders with `uSeed` 0. The Edition Lens renders edition N with its seed.

**Edition statuses.**
- `available`: no held, paying or paid order.
- `held`: a `held` or `paying` order exists.
- `collected`: a `paid`, `invoiced` or `receipted` order exists, including partially refunded ones.
- A fully refunded order makes its number available again.
- An edition number is assigned to at most one non-refunded paid order, ever at a time.

**Edition order states.**
- Legal moves:
  - `held → paying` (buy)
  - `held → expired` (timer or release)
  - `paying → paid` (Kill Bill confirms)
  - `paying → failed` (Kill Bill reports failure)
  - `paid → invoiced` (PDF stored)
  - `invoiced → receipted` (Mailpit accepted the receipt)
  - `receipted → refunded` (refunds reach the full net amount)
- Every other move answers 409 `invalid_transition`. The one exception is buying an expired hold, which answers 409 `hold_expired`.
- A `paying` order never expires; its number stays held until Kill Bill answers. `failed` frees the number.

**Hold timing.**
- A hold lasts `HOLD_SECONDS` seconds (default 600) from the moment the server grants it. `expires_at` and `seconds_left` come from the server clock.
- At or after `expires_at` the hold counts as expired. Buying answers `hold_expired`, and the number is free for others.
- A collector has at most one held order per piece. Holding a different number on the same piece expires their previous hold.
- The sheet's countdown starts from `seconds_left`, ticks every second, and resyncs from the server on reload and every 30 seconds.

**One winner.**
- When several collectors request a hold on the same available number at the same moment, exactly one request gets 201. Every other gets 409 `edition_taken`.
- `next_free` is the available number closest to the requested one, the lower number on a tie, or `null` when none is left.
- The lens refreshes edition statuses every 5 seconds and on every 409.

**Idempotency.**
- Stored responses are keyed by user, method, path and `Idempotency-Key`. They last `IDEMPOTENCY_TTL_SECONDS` seconds (default 86,400).
- A replay with the same key and an identical JSON body (compared as parsed JSON) returns the first status and body and does nothing else: no second reservation, hold, Kill Bill charge or refund.
- The same key with a different body answers 409 `idempotency_key_reused`.
- 5xx responses are not stored, so a retry after an outage runs again.
- Browser key rule: the browser reuses a key only to retry a request that got a 5xx answer or no answer at all. Every other press sends a new key, including a press after a 4xx answer such as a field error. A corrected Pay or Issue refund therefore runs fresh.

**Render jobs.**
- States: `accepted → queued → rendering → stored → ready`. Failure moves `rendering` (or `stored`) to `failed` or `timed_out`, then on to `credits_released`. Cancelling moves `queued → credits_released` with `failure_reason` `cancelled`.
- Every state reached is appended to `history`.
- A failed, timed-out or cancelled render always ends with `state` `credits_released`; its `failure_reason` and `history` keep why it ended. A render ended in error when its `history` contains `failed` or `timed_out`, which is exactly when its `failure_reason` is set and is not `cancelled`.
- Cost is `duration_s` × 1 credit at 720p, or × 2 credits at 1080p, for either format.
- Accepting a render reserves the cost atomically. Two renders accepted at once can never take the balance below zero; whichever makes the balance short gets 402.
- A render becomes `ready` only after these steps, in order:
  1. The provider returns a well-formed result.
  2. The bytes are stored in MinIO.
  3. The SHA-256 of the stored object, read back from MinIO, equals the provider's `sha256`.
- On `ready`, the reservation is captured and the render-ready email is queued. A job delivered again after it reached `ready` or `credits_released` does nothing: it neither captures nor releases twice, and it does not call the provider again.

**Retries.**
- Each provider render call times out after `PROVIDER_TIMEOUT_SECONDS` seconds (default 120). A timeout, a 5xx answer, a refused connection or a MinIO write failure counts as a failed attempt.
- A job gets at most 3 attempts. The waits before attempts 2 and 3 are `RENDER_BACKOFF_SECONDS` (default 5) and twice that.
- After the third failed attempt, the job is `timed_out` (if the last failure was a timeout) or `failed` (otherwise). Its message goes to the dead-letter queue, and its credits are released.
- A malformed result fails at once with no retry and no dead-letter: a 200 without `content_base64` or `sha256`, with invalid base64, or with a checksum mismatch.

**Credit ledger.**
- Accounts are `creator:<user id>:available`, `creator:<user id>:held`, `platform:issued` and `platform:consumed`.
- Every movement is one entry with exactly two rows of equal and opposite amounts:
  - `grant` and `pack`: issued → available.
  - `reserve`: available → held.
  - `capture`: held → consumed.
  - `release`: held → available.
- Each account's balance is the sum of its rows, and a creator's `available` and `held` are those balances. Rows are never edited or deleted; a correction is a new entry.

**Payment confirmation.**
- The callback token is the lowercase hex HMAC-SHA256 of `KILLBILL_API_KEY`, keyed with `KILLBILL_API_SECRET`.
- An event's identity is its `eventType`, `objectId` (the Kill Bill invoice id) and the `paymentId` inside `metaData` (empty when absent). An identity is processed at most once, including when the same event arrives twice at the same moment.
- For each `INVOICE_PAYMENT_SUCCESS` or `INVOICE_PAYMENT_FAILED` with a valid token, the app re-reads the invoice's payments from the Kill Bill API and acts only on what that read shows:
  - A successful purchase for the invoice's full amount confirms the order.
  - A failed payment fails a `paying` order.
  - Anything else changes nothing.
- A subscription invoice is one Kill Bill generates for a plan. The app matches it to the plan whose Kill Bill account is the event's `accountId` and whose subscription id appears on one of the invoice's items. The app grants that plan's credits once per subscription invoice id. A `pending_payment` plan becomes `active` on its first confirmed subscription invoice.
- An event is ignored when its invoice is neither an order's or purchase's invoice nor a known plan's subscription invoice. A FAILED event never undoes a confirmed payment, and events in any order end in the state Kill Bill shows.
- Polling: while an order or purchase is `paying`, or a plan is `pending_payment`, and no verified event has arrived, the app re-reads Kill Bill every 2 seconds. It reads the order's or purchase's payment, or the plan account's invoices and their payments, and applies the same confirmation.
- Confirmation, in one transaction: the order moves to `paid`, `paid_at` is set, the edition is assigned, the split rows are written, and the invoice number is taken. Then the invoice PDF is rendered and stored (`invoiced`), and the receipt goes through the outbox (`receipted` when Mailpit accepts it).
- An order is never shown as paid with missing split rows or a missing invoice number. When rendering or mail lags, the order is reported as `paid` or `invoiced` with `invoice_status` or `receipt_status` pending or queued.

**Invoice numbers.**
- The seeded invoice numbers belong to 2026. While the current UTC year is 2026, new numbers continue that sequence as stated in Seed data. In any later UTC year, the first confirmed order gets `PY-<YYYY>-000001` and the first refund gets `PY-CN-<YYYY>-000001`, where `<YYYY>` is that year.
- The format is `PY-<YYYY>-<6-digit zero-padded>`, where `YYYY` is the UTC year of `paid_at`. The sequence is gapless per year, starts at `000001`, and is shared by every app instance using the same database.
- A number is assigned once, at confirmation, and is never changed or reused, including across PDF re-render attempts.
- Credit notes use their own gapless per-year sequence `PY-CN-<YYYY>-<6 digits>`, keyed to the refund's UTC year.

**VAT.**
- Prices are tax-exclusive. VAT = net × rate, rounded half up to the cent. Gross = net + VAT.
- The rate table is: `US` 0%, `GB` 20%, `DE` 19%, `FR` 20%, `NL` 21%, `IE` 23%, `SE` 25%. Any other code answers 422 on `billing_country`.
- For example, with the seed data at start, "Lantern Static" (net $12.00) billed to `SE` is VAT $3.00, gross $15.00.

**Sale split.**
- The split is computed on the net price.
- Platform fee: exactly 10% of net.
- On a remix sale, the original creator's royalty is exactly 15% of net and the remixer takes net minus both. On a non-remix sale, the creator takes net minus the fee.
- Each share is floored to the cent. The leftover cents (net minus the floored sum) go one each to the shares with the largest fractional remainders. Ties go first to the creator, then the remixer, then the platform.
- The rows always sum to net.
- For example: a remix sale of net $19.99 floors to royalty 299, remixer 1,499 and platform 199, and the two leftover cents go to the platform (remainder 0.90) and the royalty (0.85). The final split is royalty 300, remixer 1,499, platform 200.

**Refunds.**
- Only `receipted` orders can be refunded, and only while the time since `paid_at` is at most `REFUND_WINDOW_SECONDS` (default 2,592,000, exactly 30 days, inclusive). Later requests answer 409 `refund_window_closed`.
- `net_cents` is from 1 up to the remaining unrefunded net, inclusive.
- Reversal rows split the refunded net across the order's parties in proportion to their original sale rows, with the same floor and largest-remainder rule and the same tie order. A refund that brings the total refunded to the full net reverses exactly each party's remaining amount instead.
- Reversal rows have kind `refund` and negative `amount_cents` (the allocated cents with a minus sign), so a party's rows sum to what it keeps.
- Refund VAT = refunded net × rate, rounded half up. The final refund instead returns exactly the remaining VAT.
- Kill Bill refunds the gross amount (refund net plus refund VAT) against the original payment, and the refund is recorded only after Kill Bill reports the refund transaction as successful.
- Each refund issues a credit note and a refund notice. When the total refunded reaches the full net, the order is `refunded` and its edition number becomes available.
- For example: refunding $10.00 of the $19.99 remix sale writes rows of `-150` (royalty), `-750` (remixer) and `-100` (platform).

**Plans and credit packs.**
- Plan states: `pending_payment → active` (Kill Bill confirms the subscription invoice), `active → cancelling` (cancel), `cancelling → ended` (on `ends_on`).
- Studio (`studio-monthly`, $12.00 a month) grants 300 credits, and Pro (`pro-monthly`, $36.00 a month) grants 1,500 credits, on each Kill Bill-confirmed subscription invoice payment, including the prorated first one.
- Billing is monthly in advance on the 1st at 00:00 UTC.
- Cancelling uses end of term. `ends_on` is the subscription's billing end date as Kill Bill reports it after the cancel call, which equals its charged-through date. Cancelling a `pending_payment` plan answers 409 `plan_not_confirmed`.
- A credit pack (`pack-500`) costs $19.00 and grants 500 credits when Kill Bill confirms its payment.

**Statements.**
- A month `YYYY-MM` closes at 00:00 UTC on the 1st of the next month. Closing an earlier time answers 409 `period_open`, and closing twice answers 409 `period_closed`.
- Closing renders one statement PDF per creator with lines in that month, stores it, and queues one statement email per creator. Lines are those defined for `/api/me/statements`, dated by `paid_at` or refund time. Each line's `amount_cents` is that creator's own split row: positive for `sale`, `remix_sale` and `royalty` lines, and negative for `refund` lines. `total_cents` is the sum of the lines.

**Outbox.**
- Every email is written to an outbox in the same transaction as the event that causes it. The instance that wrote it tries to send it at once.
- After a failed send, a message waits at least 15 seconds before its next attempt. Every app instance that uses the same database scans for due messages every 5 seconds. An instance claims due messages only while its latest mail probe (Services, service checks) reached mail, so an instance whose latest mail probe was unreachable, or that has no probe result yet, never claims a due message. Among the instances that may claim, any one may make the next attempt. The mail-outage and storage-outage instances each have a database of their own, so their messages and pending invoices stay with them.
- Mail recovering is exercised by the mail-recovered instance. It runs from boot alongside the mail-outage instance, with the same build and that instance's database, bucket and render queue, but with the real `SMTP_HOST` and `SMTP_PORT`. Because it is always up, the waiting state is observable only for a bounded window. Background work can run on either of the two instances: both may confirm the same paying order (through polling or a Kill Bill callback) and both consume the same render queue. So receipts and render-ready emails may be written by the mail-recovered instance and sent at once, and the waiting state is guaranteed only for messages the mail-outage instance writes while serving a request to it, for example the statement emails from `POST /api/admin/statements`. Such a message fails its first send at once and then stays waiting for at least 15 seconds after it was written. Because the mail-outage instance never claims due messages, the mail-recovered instance sends it within 45 seconds of being written, exactly once in total across both instances. Any message the mail-outage instance writes, whatever caused it, is sent within that same 45 seconds and exactly once. When a receipt written by the mail-outage instance has waited, its order shows `invoiced` with `receipt_status` `queued` while it waits, then `receipt_status` `sent` and `receipted` once it is accepted.
- Each message is sent exactly once. It is marked sent only after the SMTP server accepts it, and claiming a message for sending excludes every other instance.

**Invoice rendering retry.** Every 30 seconds, an app instance re-renders every order in its database whose `invoice_status` is `pending`: a `paid` order or a seed order. It keeps the same invoice number until the PDF is stored, and no two instances render the same order at once. Once the PDF is stored, a `paid` order moves to `invoiced` and queues its receipt, while a seed order keeps its state.

**Downloads.** Each export or invoice request checks ownership, then confirms the object exists in MinIO, then issues a new presigned GET link that expires after `PRESIGN_SECONDS` seconds (default 300).

### Services (DP-12, DP-22, DP-25, DP-27, DP-39, DP-46, DP-47, DP-48, DP-50, DP-56, DP-57, DP-59, DP-60)

- **Postgres** (`DATABASE_URL`) is the system of record for pieces, versions, timelines, assets metadata, edition runs, orders and assigned numbers, the credit ledger, split rows, refunds, the invoice and credit-note sequences, idempotency records, processed callback identities and the outbox. The app applies its schema and seed idempotently every time it serves, so an empty database becomes the seed state. Postgres unreachable at boot: the app retries every 2 seconds and answers health only once its schema is in place.
- **Keycloak** (`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`)
  - At start, the app uses its client's service account to create the realm roles `creator`, `collector` and `founder-operator` if missing, and the seeded users if missing.
  - Browser sign-in is authorization code with PKCE. The session cookie is HttpOnly and SameSite=Lax.
  - A self-registered user gets `creator` and `collector` on first sign-in.
- **Kill Bill** (`KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`)
  - At start, the app uploads its catalog to the tenant if none exists: products Studio and Pro, plans `studio-monthly` and `pro-monthly`, monthly in advance, USD. It also registers its callback URL `<APP_PUBLIC_URL>/api/billing/killbill-events?token=<token>`.
  - Each buyer or subscriber has one Kill Bill account with external key equal to their Keycloak user id, currency USD, time zone UTC, bill cycle day 1, and Kill Bill's built-in external payment method as default.
  - An edition purchase is an external charge of the gross amount on the collector's account, described `<piece title> — edition <N> of <M>`, paid with the external payment method. A credit pack is an external charge of $19.00 described `Credit pack — 500 credits`. A plan is a subscription to its plan code. A refund is a refund of the gross refund amount on the original payment.
  - Kill Bill down: buy, refunds, plan changes and packs answer 503 `payments_unavailable`, and nothing is recorded locally. Holds keep their timers. Paying orders stay paying until Kill Bill answers.
- **MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). The bucket stays private. Object keys:
  - `pieces/<slug>/assets/<asset id>/<file name>`
  - `renders/<render id>/export.<mp4|webm>`
  - `invoices/<YYYY>/<invoice number>.pdf`
  - `credit-notes/<YYYY>/<credit note number>.pdf`
  - `statements/<YYYY-MM>/<creator user id>.pdf`

  MinIO down: uploads and downloads answer 503 `storage_unavailable`. Render attempts fail as storage errors under the retry rule. Invoice rendering stays pending.
- **RabbitMQ** (`AMQP_URL`)
  - Render jobs go to the durable queue named by `RENDER_QUEUE` (default `render.jobs`) as persistent messages. `message_id` is the render id, and the body is `{"render_id","piece_slug","attempt"}`. Consumers acknowledge manually after the job's state change is committed.
  - Jobs out of retries go to the durable queue `<RENDER_QUEUE>.dead` with the body plus `"failure_reason"`, where they stay for the founder's Renders tab.
  - Delivery is at least once. A job delivered again follows the redelivery rule in Business rules.
- **AI and render provider** (`WIREMOCK_URL`). The provider and all its data are invented. The app calls it as a third-party JSON API:
  - `POST /v1/shader-graphs` with body `{"prompt":"<text>","engine":"GLSL"}` → 200 `{"graph_id","engine":"GLSL","title_suggestion","fragment_source","uniforms":[{"name","label","min","max","default"}]}`.
    - `fragment_source` is a GLSL ES 1.0 fragment shader that reads `uResolution` (pixels), `uTime` (seconds), `uSeed` (0 to 1) and each listed uniform.
    - The draft's title is `title_suggestion`, and its slug is the title in lowercase kebab case plus `-` and 4 lowercase hex characters.
    - This call has a single attempt with a 20-second timeout (or `PROVIDER_TIMEOUT_SECONDS` if smaller). A timeout, 5xx or refused connection answers 503 `provider_unavailable`.
    - A 200 that fails the server's shape check answers 502 `provider_malformed`. The check fails on any of these:
      - any field missing;
      - `uniforms` empty;
      - a uniform whose `min` is not below its `max`, or whose `default` lies outside them;
      - a `fragment_source` that lacks the text `void main`;
      - a `fragment_source` that lacks a `uniform` declaration naming each of `uResolution`, `uTime`, `uSeed` and every listed uniform.

      The server never compiles GLSL, and this check is the whole 502 rule.
    - In both the 503 and 502 cases, no piece is created.
    - After the draft exists, the editor's validator compiles the shader in the browser and prints the compiler log in the validator region. A shader that fails there keeps its draft, and the canvas shows the near-black ground.
    - Baseline answer: `graph_id` `sg_demo_0001`, `title_suggestion` `Untitled tide`, uniforms `uHue` (label `Hue`, 0 to 1, default 0.58), `uFilm` (label `Film thickness`, 0 to 1, default 0.4) and `uDrift` (label `Drift`, 0 to 2, default 0.8).
  - `POST /v1/renders` with header `X-Job-Id: <render id>` (the same on every attempt) and body `{"job_id","fragment_source","uniforms":{"<name>":<value>},"timeline":{...},"format","resolution","duration_s","aspect"}` → 200 `{"render_id","content_base64","sha256"}`, where `sha256` is the lowercase hex SHA-256 of the decoded bytes. Baseline answer: `render_id` `rn_demo_0001`, `content_base64` `YWJj`, `sha256` `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  - Provider down: describing answers as above. Renders still accept and reserve, then fail under the retry rule.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`). The From line is the value of `MAIL_FROM`, which the environment sets to `Phosphene Yard <studio@brightmoss.example>`. Every email the app sends:
  - Receipt to the order's `email`: subject `Your receipt for <piece title> — edition <N> of <M>`, with the invoice PDF attached as `<invoice number>.pdf`.
  - Render-ready to the creator's Keycloak email: subject `Export ready: <piece title>`.
  - Refund notice to the order's `email`: subject `Refund issued: <credit note number>`, with the credit note attached as `<credit note number>.pdf`.
  - Payout statement to each creator: subject `Your <Month YYYY> statement from Phosphene Yard`, with `statement-<YYYY-MM>.pdf` attached.

  Email bodies never contain presigned links. Mail down: messages wait in the outbox, and orders stay `invoiced` with `receipt_status` `queued` until the receipt is accepted, with the waiting window and delivery bound from Business rules (Outbox).
- **Gotenberg** (`GOTENBERG_URL`). The app posts HTML to `/forms/chromium/convert/html` and stores the PDF it returns.
  - The invoice PDF shows: `Invoice <invoice number>`, the issue date, the seller (the selling creator's display name and seller address), `Sold through Phosphene Yard by Brightmoss Works`, the buyer's billing name, email and billing country, the line `<piece title> — edition <N> of <M>`, and the net, `VAT <rate>%`, VAT amount and gross in dollars. For a remix, the seller is the remixer.
  - The credit note PDF shows `Credit note <credit note number>`, `Refers to invoice <invoice number>`, and the credited net, VAT and gross.
  - The statement PDF shows `Statement <Month YYYY>`, the creator's display name, the statement lines and the total. It never shows buyer emails, billing countries or invoice numbers.
  - Gotenberg down: confirmed orders stay `paid` with `invoice_status` `pending` and their invoice number, the receipt is not queued until the PDF exists, and refunds are recorded with their credit note number while the credit note PDF and refund notice wait for the same 30-second retry.
- **Service checks.** The app probes each of Kill Bill, the provider, Gotenberg, mail and MinIO every 10 seconds. Each instance probes with its own configuration and keeps only its latest results in its own memory. `GET /api/admin/services` and the banners show the probes of the instance answering, so the main instance shows no banners while an outage instance's dependency is down. `GET /api/admin/services` and the banners reflect the latest probe, so a banner appears or clears within 20 seconds of the change. The console re-reads the services every 10 seconds.

### Seed data (DP-31, DP-32, DP-36, DP-44, DP-49, DP-52, DP-53, DP-58, DP-59)

Every person, studio and address below is invented. Applying the seed to an empty database (and the matching Keycloak users and MinIO objects) produces exactly this state.

**Accounts.** Keycloak users, all with email verified:

| Username | Display name | Email | Roles | Password |
|---|---|---|---|---|
| `wren.okafor` | Wren Okafor | `wren@brightmoss.example` | founder-operator | `Yard-Founder-2026` |
| `ilse.marrow` | Ilse Marrow | `ilse@studio-marrow.example` | creator | `Yard-Creator-2026` |
| `tobi.ansel` | Tobi Ansel | `tobi@ansel-loops.example` | creator | `Yard-Creator-2026` |
| `odile.renn` | Odile Renn | `odile@renn-signal.example` | creator | `Yard-Creator-2026` |
| `june.halloway` | June Halloway | `june@collectors.example` | collector | `Yard-Collector-2026` |
| `pax.ferreira` | Pax Ferreira | `pax@collectors.example` | collector | `Yard-Collector-2026` |
| `nell.quist` | Nell Quist | `nell@collectors.example` | collector | `Yard-Collector-2026` |

**Seller addresses:**
- Ilse Marrow: `Studio Marrow, 12 Lindenstraat, Utrecht, Netherlands`
- Tobi Ansel: `Ansel Loops, 4 Hafenweg, Bremen, Germany`
- Odile Renn: `Renn Signal, 9 Rue des Lampes, Lyon, France`

**Credits** (one `grant` entry each): Ilse 600 available, Tobi 40 available, Odile 0. No one has a plan.

**Pieces.** All GLSL, with original shaders of your own making that use the uniform contract above:

| Slug | Title | Creator | State | Run | Price | Collected numbers |
|---|---|---|---|---|---|---|
| `tidewire-bloom` | Tidewire Bloom | Ilse | published, featured | 40 | 2400 | 1, 5 |
| `salt-halo` | Salt Halo | Ilse | published | 12 | 999 | none |
| `lantern-static` | Lantern Static | Tobi | published | 3 | 1200 | 1, 2 |
| `halo-undertow` | Halo Undertow | Tobi | published, remix of `salt-halo` | 25 | 1999 | 4 |
| `night-loom` | Night Loom | Ilse | draft, version 1 | none | none | none |

- Each published piece has one ready 1080p, 16:9, 10-second MP4 export stored in MinIO at start.
- "Night Loom" has uniforms `uHue` 0.12, `uFilm` 0.7 and `uDrift` 0.5, a 10-second timeline, and one `Hue` track with keyframes at 0.0 s (0.12, `ease-in-out`) and 5.0 s (0.4, `ease-in-out`). It has no audio stem.
- The featured run is "Tidewire Bloom" while it is published, otherwise the most recently published piece.

**Orders.** All `receipted`, paid at 12:00 UTC on the given date. They exist only in the app; there are no Kill Bill records, and no emails are sent for them.
- They start with `receipt_status` `sent` and `invoice_status` `pending`.
- The invoice rendering retry in Business rules renders and stores their PDFs. Each order then shows `invoice_status` `ready`, stays `receipted`, and queues no receipt.
- Until its PDF is stored, a seed order's invoice download answers the 409 `invoice_pending` from API.

| Invoice | Paid | Piece, edition | Buyer | Country | Net | VAT | Gross | Split |
|---|---|---|---|---|---|---|---|---|
| PY-2026-000001 | 2026-10-02 | Tidewire Bloom #1 | June | US | 2400 | 0 | 2400 | Ilse 2160, platform 240 |
| PY-2026-000002 | 2026-10-02 | Lantern Static #1 | Pax | FR | 1200 | 240 | 1440 | Tobi 1080, platform 120 |
| PY-2026-000003 | 2026-10-03 | Halo Undertow #4 | June | DE | 1999 | 380 | 2379 | Ilse royalty 300, Tobi 1499, platform 200 |
| PY-2026-000004 | 2026-10-04 | Lantern Static #2 | June | US | 1200 | 0 | 1200 | Tobi 1080, platform 120 |
| PY-2026-000005 | 2026-10-05 | Tidewire Bloom #5 | Pax | FR | 2400 | 480 | 2880 | Ilse 2160, platform 240 |

At start, while the current UTC year is 2026, the next invoice number is `PY-2026-000006` and the next credit note is `PY-CN-2026-000001`. In any later UTC year, that year's first confirmed order is `PY-<YYYY>-000001` and its first credit note is `PY-CN-<YYYY>-000001`, with `<YYYY>` that year. "Lantern Static" #3 is the last unsold edition of its run, and October 2026 is closable. For example, with the seed data at start, Ilse's October 2026 statement totals 4,620 cents, and Tobi's totals 3,659. Nell Quist and Odile Renn own nothing, and `/gallery?creator=odile.renn` is empty.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`.

- Node 22 and npm are available. Commit the npm lockfile.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the schema is applied, whether or not any provider is reachable.
- The same build serves several instances at once against shared services (different ports and environment, sometimes a separate database, bucket and render queue), so all start-up work is idempotent and safe to run concurrently.

### Configuration and secrets (DP-05)

The app reads these at start and never hard-codes them:
- Service connections: `DATABASE_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `AMQP_URL`, `WIREMOCK_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `GOTENBERG_URL`, `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`.
- Timers and queue: `HOLD_SECONDS` (600), `PROVIDER_TIMEOUT_SECONDS` (120), `RENDER_BACKOFF_SECONDS` (5), `REFUND_WINDOW_SECONDS` (2592000), `IDEMPOTENCY_TTL_SECONDS` (86400), `PRESIGN_SECONDS` (300), `RENDER_QUEUE` (`render.jobs`). The values in brackets are the defaults when unset.

No credential, secret, token or internal service URL appears in any page, script bundle, API response or log line sent to the browser. The only exceptions are the Keycloak sign-in redirect and presigned MinIO links.

### Server boundary (DP-04)

- The browser only talks to the app's own origin, except the Keycloak sign-in pages and presigned MinIO downloads. The app sends no CORS allowance to other origins.
- JSON bodies may be up to 1,000,000 bytes inclusive; larger bodies answer 413. Uploads may be up to 20,000,000 bytes inclusive; larger ones answer 413. A write with a body in any other content type answers 415.
- The server never serves source files, source maps, `.env` files, the run manifest, lockfiles or dependency folders. Such paths answer 404.
- Kill Bill, Postgres, RabbitMQ, Gotenberg and the provider are reached only from the server.
- When Kill Bill, the provider, Gotenberg, mail or MinIO is unreachable at boot or later, the app still starts and serves. Each affected action answers as described in Services, and every other page works.

### Browser support and performance (DP-09, DP-10, DP-33)

- Current Chromium, Firefox and WebKit at the three published viewports, with mouse, keyboard and touch.
- The landing page shows the running hero and accepts lens input within three seconds on a warm load.
- The lens follows the pointer and the numeral changes within one animation frame of the move.
- Canvases hold at least 30 frames per second on desktop.
- Off-screen canvases stop drawing.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to run the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its licence, plus the fonts (Archivo, Unbounded, Hanken Grotesk, JetBrains Mono under OFL-1.1) and Lucide icons (ISC).
- IF-03: Every shipped package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, OFL-1.1 or CC0-1.0.
- IF-04: No datastore, queue, cache or external service beyond those named in this brief is added (no SQLite, Redis or file-based database). No state lives only in memory or on local disk, except each instance's latest service-check results, which the brief keeps per instance.
- IF-05: The provided development compose files and service configuration are left unmodified.
- IF-06: The npm lockfile is committed, and the backend and frontend TypeScript compile with `strict` enabled.

## Engineering standards

- The TypeScript is idiomatic and strictly typed, with no `any` on domain data. Names match this brief's domain terms: piece, edition run, hold, order, render job, credit ledger entry, split row, invoice number, credit note, statement.
- Each domain rule is decided in exactly one place in the source: each state machine's legal transitions, the split and refund allocation, VAT, the invoice sequence, render cost, hold expiry and the callback token check.
- Every API error comes from one error type that produces the single error body from API.
- No abstraction exists with only one implementation, and no feature exists beyond this brief.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the code's own types or transitions make impossible.
- Money is integer cents end to end, and floating point never touches an amount.
- Provider calls go through one client per provider that applies the brief's timeout and maps failures to the brief's error codes.
