# Northbar Camera Hire Tallyslate — intended behavior

This is the intended product, not a description of self-test data. The sole product authority is `instruction.md`. `brief: <section>` identifies a required value or behavior; `decided: <reason>` records a choice where the brief is silent. Detailed visual tokens and enhancement decisions are in `DESIGN.md`; implementation coverage is in `PLAN.md`.

## Ideal end-to-end journeys

### 1. Find and price a kit

Start with the seeded catalogue and no dates. Show **Pick your shoot dates** and **Set a pickup day and drag the return handle to see what's free and what it costs.** Show each kit's day rate and component list, with no free-for-dates count before dates exist. Source: brief: Journeys 1, Screens and layout, Feedback states.

Set Pickup date, then move Return day from 1 through 14. Each step requests the server's price and refreshes availability; pickup plus N is the return date. Days 1–3 and 8–10 bill; days 4–7 and 11–14 are free. A Friday pickup of two or three hire days is one billable weekend. Free runs collapse to a one-cell hatched band labelled `free`; a Friday weekend is `weekend · 1 day`. The server figure settles before the billable count and **Hire total $<hire> for <n> billable days** announcement. Dates remain in the URL. Source: brief: Interactions, House pricing, Motion and effects.

The day strip retains a neutral return-day number until pickup exists; it does not invent a return date from the device clock. Source: decided: an unset date must not look like a quoted date.

Every sheet remains in seed category order. With dates it shows the server's free complete-kit count and hire price. When none is free, show **Nothing free for these dates** and the published explanatory sentence. There is no provider side effect on this journey. Source: brief: DP-01–05, Feedback states, Seed data.

### 2. Hold a kit

Open a kit sheet. Read the top band, day strip, class unit tables and hold form in that order. Any free serial is the default for each class; a specific free serial may be selected, while booked and repair radios are disabled and hatched. Enter Your name and Email, then Hold this kit. Source: brief: Journeys 2, Screens and layout, Public screens and controls.

The server assigns one lowest free or explicitly requested serial per class, under a Postgres claim lock. Ranges overlap including the return day. If any class loses its unit, nothing is assigned: show **This unit was just booked**, the published serial-specific sentence, and Book <serial> instead or Choose new dates. Focus moves to that action. Source: brief: Assignment and availability, DP-06–10, Feedback states.

Success creates one quote, stored price and rate-card version, opaque private renter key and server expiry. The private booking page says **Held for you** and **Booking <ref> is on hold. Upload your certificate and confirm before the hold ends.**, with Deposit: Not taken. Idempotent replay returns the original status and body without a second booking. No payment, mail or storage effect occurs at hold. Source: brief: API, Hold and expiry, Feedback states.

### 3. Insure the hire

Upload a PDF beginning `%PDF-`. Show Uploading certificate, then Certificate received. The owner will review it before you can confirm. The server writes the exact uploaded bytes to `certificates/<ref>/<certificateId>.pdf`, confirms MinIO acceptance, then records the latest certificate as pending_review. Boundary-like byte sequences inside a PDF are preserved unless they are an actual multipart delimiter line. Source: brief: Certificates, MinIO, Server boundary, DP-11.

The owner signs in, opens Review <ref>, reads Open certificate PDF, and approves with Cover starts, Cover ends, Limit and the loss-payee checkbox, or rejects with Reason. Approval records the stated cover and shows Certificate approved. Rejection sends **Certificate not accepted · <ref>**, including **Reason: <reason>**, once for that review; the renter sees Certificate not accepted: <reason>. A refused rejection mail leaves review pending so the same decision can be retried. The rejection-mailed flag follows SMTP acceptance. Source: brief: DP-12, Public controls, Feedback states, Mailpit; decided: retain the actionable pending review when its required rejection notification is refused.

Unknown certificate IDs, including non-UUID strings, answer 404; resource existence precedes owner-role rejection. Source: brief: Error precedence.

### 4. Confirm and pay

An approved certificate and a running server hold enable Confirm and pay. On submit show Taking payment and Deposit: Pending. Re-read stored state under a lock, reprice first if today's active rate-card version changed, verify the certificate object in MinIO, then purchase the stored total in Kill Bill, send the confirmation mail and commit confirmed / paid. A repriced quote shows **Prices changed on <date>. Check the new total and confirm again.** Source: brief: Confirmation, Effective-dated prices, Feedback states, DP-13–17/21.

Kill Bill uses one lower-case-email external account key, USD and its built-in `__EXTERNAL_PAYMENT__` default plugin. Purchase external key is <ref>, transaction key is <ref>-confirm, and the amount comes from stored cents. Paid requires a successful provider purchase whose net collected amount still covers the total. A fully refunded earlier purchase cannot count as payment on retry. An unreadable purchase result is reconciled through its permanent external key and compensated when the purchase is found. Source: brief: Kill Bill, DP-14/15/46; decided: reconcile provider effects before treating a lost answer as absence.

The accepted SMTP DATA reply is the mail-success boundary; disconnection afterward cannot undo delivery. Confirmation subject and body use the exact published subject, unit lines, dates, billable days, day rate, hire, deposit, charged total and rate-card version. Then show **You're booked** and **Booking <ref> is confirmed. We've emailed your serial list to <email>.** Source: brief: Mailpit, Confirmation, Feedback states.

Storage absence makes no payment call and returns certificate_not_stored. Provider unreachability leaves a quote and its prior payment status. A declined purchase shows Failed. A refused confirmation mail causes a full rollback refund, leaves paymentStatus none and returns mail_unavailable. Concurrent confirms produce one provider payment; idempotent replay returns the stored response. The final commit rechecks the hold and latest approved certificate, preventing expiry or a superseding upload from resurrecting a released claim. Source: brief: Confirmation, Concurrency for writes, DP-15/17/19.

A renter or owner may cancel only a confirmed booking through the Cancel booking dialog. A successful full provider refund commits cancelled / refunded and releases assignments. Closing the dialog returns focus to the original, still-live button even after a 30-second booking refresh. Source: brief: Cancellation, Dialogs, DP-35/36.

### 5. Prep and check out

Staff sign in and open the counter. Desktop initially selects the first active booking in pickup/ref order; phone and tablet initially show the list. Prep kit requires confirmed state and every assigned serial on the shelf. Swapping a serial is allowed before prep in quote or confirmed state, for a free serial of the same class. Source: brief: DP-22/23/26, State machine and rights.

Start checkout follows only the server checkout gate: prepped, latest approved insurance covering pickup through return and the full replacement value. Scanning opens the unit and keeps focus in Scan serial; Tab reaches Powers on, Accessories present, Cosmetic condition as listed, Condition notes, Condition photo and Done with unit in order. Store a photo and tick every check to finish. The group collapses and focus returns to Scan serial. Source: brief: Checkout gate, Interactions, DP-24/25/27/29.

Every photo is pending before MinIO write, stored only after acceptance, and failed on refusal. Only stored photos count. After every unit is done, Tab reaches Review checkout. The Confirm checkout dialog traps focus; Check out kit records one paired shelf → booking:<ref> movement per unit and commits out. The counter announces Kit out · <ref> and focuses its detail heading. A serial sent to repair between prep and checkout cannot debit an empty shelf location. Source: brief: Photos, Movement ledger, Interactions, DP-27/32/33.

### 6. Check in and close

Start with an out booking. Start check-in focuses Scan serial. Scan, choose OK or Damaged, enter cents through a decimal-dollar field for damage, add notes and store a check-in photo. Check in unit records the condition and charge, moves the unit booking:<ref> → shelf for OK or → repair for Damaged, and returns focus to the live scan field. Explicit JSON null is not zero money. The last unit changes state to returned; Scan serial remains present and Tab reaches enabled Close check-in when all photos are stored. Source: brief: Check-in, Interactions, DP-28–31/32.

Close first creates a damage invoice when needed and refunds deposit minus damage when positive, using transaction <ref>-refund. It stores settlement figures, attempts the return receipt, then commits closed. Damage may equal the whole deposit, in which case refund is zero and payment remains paid. Source: brief: Close gate and Close, Kill Bill, DP-30.

Damage invoices are staged as real provider drafts and reconciled by their booking description and amount before creation, then committed after refund success. A refund failure cannot add a second invoice on retry. A draft has no committed charge balance. This is an implementation choice for recovery across services; normal successful close follows the published sequence and provider effects. Source: decided: preserve a retryable settlement without duplicate damage charges; brief: Kill Bill, Idempotency, All-or-nothing provider effects.

Return receipt subject and lines follow Mailpit exactly. If its send is refused after payment settlement, the booking still closes with 200 and is never resent. receipt_mailed is true only after SMTP accepted it; terminal closed state prevents retries even when the flag is false. A replay does not repeat settlement or mail. Source: brief: Close, Mailpit, DP-30.

### 7. Run the house

Owner desk sections are Utilisation, Kits, Certificates to review, Rate cards and Units. Display current out, shelf, repair and percentage counts, ready-to-go kit counts, pending reviews, version history and serial histories. A prep tech sees This page is for the owner. Source: brief: Owner desk, Public controls.

Publish supplies one integer-cent day rate and deposit per kit, effective today or later. Versions are allocated serially in publish order across instances. Latest effective date on or before today wins, with highest version on ties. Future cards do not affect today's quotes. Confirmed and later bookings keep stored prices. Source: brief: Rate cards, DP-20/21.

Manual unit movement permits only shelf → repair and repair → shelf. Every movement has exactly −1 from and +1 to, and all movements remain immutable. Location, free-for-dates, ready-to-go and utilisation derive from ledger balances plus active assignments; no counters are a separate record. The 16 seeded units balance acquired −1 and exactly one physical location +1. Source: brief: Movement ledger, Derived counts, Seed data, DP-32–34.

### 8. Lose the hold

A quote starts with HOLD_SECONDS remaining (default 172800). The browser counts elapsed monotonic time from the server's remaining seconds, never subtracting the device clock from an expiry instant. Refetch every 30 seconds and at zero; show expired only when the server says so. Source: brief: Hold and expiry, Booking page interactions, DP-18/19.

At expiry the quote holds nothing. Reads use effective expired state immediately; a server sweep persists the transition. Show **This hold has ended** and **The units have been released. Pick dates again to make a new hold.** Keep Confirm and pay visible and disabled. No expired request may reclaim released serials, even after a slow provider call. Source: brief: Hold and expiry, Feedback states, DP-18/19.

## Palette, typography, space and layouts

The exact app palette is paper #f7f2e8, sheet #fbf7ef, ink #16110e, secondary ink #413530, oxblood #6b1220, pressed oxblood #4d0c17, signal red #b3261e, hatch dark #d8d0c2 and hatch light #ece5d7. Source: decided: translate the warm off-white, near-black, oxblood, signal-red and warm-grey roles in brief: Visual design. DESIGN.md records contrast and use.

IBM Plex Sans is body/table text at 16px / 1.5, weights 400/600. Big Shoulders Display is the condensed display face, weights 400/600/700, with 24/36/54px heading scale, 96px price and count numerals, including the booking summary figures, narrowing on phone. Source: brief: Type (families, 1.5 scale, six-times numerals); decided: 16px body.

Spacing uses an 18px grid, 72px sheet/section gaps and 144px category gaps. Rules are 1px oxblood, corners square and surfaces flat. Focus is a 2px oxblood outline with 2px offset. Targets are at least 44px each axis. Source: brief: Density and grid, Targets and contrast; decided: one-pixel rules and square paper edges.

Below 768px, including 375x812: wrapped top category links, name/price/free stack, explicit week-one/week-two strip rows, and one counter pane at a time. At 768px through below 1280px, including 768x1024: top category links, constrained heading-left / price-right band, all 14 strip positions on one row, and one counter pane. At 1280px and wider, including 1280x800: sticky 220px category/desk rail, 72px content gap, and counter list/detail in 1:2 columns. Source: brief: Screens and layout (breakpoints and arrangements); decided: rail width and exact pane ratio.

Booking is always a single centred column, desktop max 48rem. Sign-in is a single sheet with max 42rem. Phone serial tables become labelled rows to keep identifiers and actions readable without hiding overflow. Source: brief: Screens and layout; decided: printed-sheet measures and readable narrow tables.

## Motion table

| Element | Trigger | Duration | Easing | Animated properties | Reduced motion | Source |
|---|---|---|---|---|---|---|
| Free day band | return handle enters/leaves free run | 220ms | cubic-bezier(.16,.84,.28,1) | width | instant same fold and labels | brief: Week fold; decided: exact permitted duration/easing |
| Price digits | new server quote | 360ms | cubic-bezier(.16,.84,.28,1) | transform per changed digit | instant server total and count | brief: Week fold; decided: exact permitted duration/easing |
| Dialog | open | 200ms | ease-out | opacity, translateY | no motion | brief: Other motion; decided: exact permitted duration |
| Service notice | provider down | 260ms | ease-out | opacity, translateY | no motion | brief: Other motion; decided: exact permitted duration |
| Button | hover/press | 90ms | ease-out | background-color, color | immediate colour | brief: Other motion; decided: exact permitted duration |

All states and live announcements remain under reduced motion. No decorative loop, spinner, stock animation or external script is used. Source: brief: Motion and effects.

## Async states and failures

| Action | Pending | Success | Failure | Source |
|---|---|---|---|---|
| Price/range | previous server figure until reply | server days, counts, price and settled live total | API field message; no invented price | brief: Return handle, Feedback states |
| Hold | Holding your units, disabled submit | private Held for you page | unit-taken alert/action, or inline API message | brief: Feedback states |
| Certificate | Uploading certificate | pending review after stored write | no certificate record on storage failure; API message and storage banner | brief: MinIO, Feedback states |
| Review | focused dialog | approved or rejected, named Desk status | API message; rejected decision remains retryable if mail refused | brief: Public controls, Mailpit; decided: retryable notification |
| Confirm | Taking payment / Pending | Paid / You're booked | declined, repriced, expired or provider-specific error; payment compensation as above | brief: Confirmation, Feedback states |
| Photo | Pending / Uploading photo | Stored | Failed, API message and storage banner | brief: Photos, Feedback states |
| Counter write | task remains in pane | exact Counter status and required focus | API message in Counter status and beside relevant control | brief: Interactions, Feedback states |
| Rate/repair write | focused current task | exact Desk status | API message in Desk status | brief: Feedback states |
| Provider status | probe on load and every 30 seconds | absent notice when up | exact Payments are offline / Photo storage is offline banner until next up status | brief: Feedback states, Services |

Provider status probes run at most two seconds each, with at most ten-second cache. Provider actions use real responses with five-second limits. Health depends only on reachable Postgres. Source: brief: API /status, Services, Deployment.

## Boundaries, storage and deployment

All JSON errors use the shared ApiError shape. Size/type precede authentication, existence, role, idempotency, state and JSON/field validation, then provider errors. Unknown /api routes are 404. JSON is capped at 100000 bytes; each file at 5000000 bytes, inclusive. Multipart delimiters require line framing. Full origins include scheme; Origin: null is foreign. A bodyless sign-out requires no representation type, while a supplied body must satisfy the JSON type and size limits. Source: brief: API Error precedence and Server boundary; decided: no media type is required when DELETE /session supplies no body.

Only Postgres and MinIO store records. Sessions, idempotency and all domain state are in Postgres. Environment credentials are read only in server/config.ts. No secrets, source, maps, package files or run manifest are served. All fonts, icons and scripts come from the app origin. Source: brief: Configuration and secrets, Server boundary, IF-01–06.

`run.json` uses npm ci, npm run build and npm run start. Serve applies schema and seed, supports multiple instances, retries an unreachable database for up to 60 seconds, and starts even when payments or storage is unavailable. Bind is 0.0.0.0, port APP_PUBLIC_PORT with default 4173. Source: brief: Deployment, Boot.

Every environment variable, service and command is listed in app/USER_README.md. All runtime and build packages, transitive packages, fonts and Lucide notices are in app/THIRD_PARTY_NOTICES.md; assets.json records shipped font and favicon hashes. Source: brief: Required files, IF-01/02/03/05.

## Media and licences

Two self-hosted WOFF2 fonts are Big Shoulders Display and IBM Plex Sans, OFL-1.1, with full OFL text and project copyright notices. Inline icons are Lucide (ISC); the favicon is procedural SVG combining an original paper ground with the Lucide camera glyph (ISC). Free and unavailable hatches are original CSS diagonal patterns. There are no packaged photographs, audio, video or models. Certificates and condition photos are user-supplied runtime uploads stored through the app in MinIO. Source: brief: Type, Icons, MinIO, Working rules; decided: a local camera mark on the paper ground.
