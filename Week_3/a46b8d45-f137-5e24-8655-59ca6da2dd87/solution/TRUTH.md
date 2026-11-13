# TRUTH — Holmgarth Aftercare Fittings Desk (golden)

The brief made concrete. Every value says where it came from: `brief: <section>` (copied verbatim from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys: start state, each action, visible and provider-recorded end state

### 1.1 Claim a part (owner, phone, no account)

| Step | Action | Visible result | Provider-recorded result | Source |
|---|---|---|---|---|
| 1 | Open `/`, press `link "Start a claim"` | address `/claim/new`; claim form with the empty fan sheet | none | brief: Journeys 1 |
| 2 | Choose the model in `combobox "Model"` | the model's fitting fan is drawn above (phone) or left (768+) of the form; the select only appears once the catalogue has loaded | `GET /api/models`, `GET /api/models/<slug>` read Postgres | brief: Interactions — Claim form 1 |
| 3 | Drag the slider / use keys, tap or Enter a part | `data-active-part` = booklet number, `aria-pressed` true on that part only, "Part 3: Shelf pin" and "Part number 101345" (mono) under the form; a withdrawn part has `aria-disabled` and ignores selection | none | brief: Interactions — Claim form 2, Fan input |
| 4 | Enter details and press `button "Estimate carriage"` (repeatable) | status "Asking the carrier…", then `Band S2 · £3.95` in `region "Carriage estimate"`; only the newest press's answer is ever shown; a refusal shows the carrier copy in the region and the alert region; `Start claim` stays enabled | `GET <WIREMOCK_URL>/v1/carriage/quote?weight_g&longest_side_mm&postcode_area`, 4 s wait | brief: Interactions 3, API |
| 5 | Add 1–4 photos, press `button "Start claim"` | button disabled, status "Sending your claim…"; on refusal field errors beside fields, each refused photo listed, alert region carries the first message and takes focus; on success address `/claim/<ref>/sent` | one Postgres transaction: `claims` row (`state` started, `confirm_by` = start + TTL), `claim_history`, `claim_photos`; MinIO `claims/<ref>/photos/<i>` byte for byte; one Mailpit message `Confirm your Holmgarth claim <ref>` with `/confirm/<token>` and the lifetime line; any failure removes all three | brief: Interactions 4–6, Business rules — All-or-nothing |
| 6 | Read the sent page | heading `Check your email`, the sent text, `This link works until HH:MM on <date> (UK time).` from the server's `confirm_by` on the Europe/London calendar; lapsed link: refusal copy in place of the line; used: "This claim is already confirmed…" | `GET /api/claims/<ref>/confirmation` | brief: Sent page |

### 1.2 Confirm the claim

| Step | Action | Visible | Recorded | Source |
|---|---|---|---|---|
| 1 | Open `/confirm/<token>` from the email | one centred column: header, `Confirm your claim`, `button "Confirm my claim"` (enabled whenever the page is open) | none (nothing confirmed by opening) | brief: Confirmation |
| 2 | Press it | disabled, status "Confirming…"; address `/s/<share token>`; slip shows Confirmed; history entry at the stored instant | `claims.state` confirmed, `confirmed_at` = `claim_history[1].at` = the instant compared against `confirm_by`; one `share_tokens` row; no mail | brief: Journeys 2, Business rules — Confirmation instant |
| 3 | Refusals | lapsed 410, used 409, unknown 404 (also a share token, another claim's reference, an erased claim's token): copy in the alert region, button enabled again, address unchanged | unchanged | brief: Journeys 2, API |

### 1.3 Identify and rule (operator)

Sign in at `/ops/sign-in` (`operator@holmgarth.example`, seeded) → `/ops/claims` queue (newest confirmation first) and `status "Decided claims"` → open a claim → workspace. Pick the part on the fan (pointer, keys or `]`/`[`), set quantity, press `Identify part` → status "Part identified. Ruled by edition AC-2026." and address `/ops/claims/<ref>/quote`; slip shows Inside/Outside aftercare, `Cover until HH:MM on <date>`, `Ruled by edition <code>` with the `edition` caption. Recorded: `claims.state` identified; ruling columns (inside, edition, cover end instant, cover end date, term months) made once; `decided_counts` +1 and inside/outside +1. — brief: Journeys 3, Business rules — Ruling, Aftercare term, Editions.

### 1.4 Quote, take payment, dispatch

| Action | Visible | Recorded (provider) | Source |
|---|---|---|---|
| `Get quote` once (button disabled until the answer, status "Working…") | address `/ops/claims/<ref>/quote/<revision>`; "Quote revision N", part line, carriage line, total with `billing`/`carrier` captions, the dispatch promise; status "Quote revision N recorded in billing." | carrier asked; Kill Bill: account (name and external key = reference, GBP, no owner data) at the first quote, one committed invoice with items `Part <part number> × <quantity>` and `Carriage band <band>`; figures read back from Kill Bill are stored; bin stock taken or supplier-ordered; quoted notice | brief: Journeys 4, Business rules — Quote figures |
| `Re-quote` while unpaid | new revision slides in; older ones inside `Earlier revisions (n)`, collapsed | previous invoice VOID, its bin units returned once, new invoice | brief: Revisions |
| `Record payment` | address unchanged; status "Payment of £x recorded in billing."; `Re-quote` disabled, `Dispatch` enabled | external payment of the whole balance, successful PURCHASE | brief: Payment |
| `Dispatch` | address `/ops/claims/<ref>/dispatched`; `link "Dispatch note"`; status "Dispatched. Dispatch note stored." | MinIO `claims/<ref>/dispatch-note.html` (`text/html; charset=utf-8`) with the Kill Bill figures; dispatched notice | brief: Dispatch note |
| `Close claim` | address `/ops/claims/<ref>`; status "Claim closed." | state closed; share link ends (410 `claim_closed`); closed notice without a link | brief: Close |

### 1.5 Decline or refund

`Decline` opens `dialog "Decline claim"` (focus on the first radio; Tab and Shift+Tab wrap; Escape/Cancel close and return focus to `Decline`); `Confirm decline` needs a reason. Unpaid: invoice VOID, balance read back (0), slip "Nothing charged". Paid: one REFUND for the whole PURCHASE, slip `Refunded £x`. Bin units of a bin revision return once. State declined, address `/ops/claims/<ref>/declined`, declined notice (subject `Claim <ref> declined — nothing charged` / `— £x refunded`). The dialog closes when the answer arrives; the message shows in the page's status or alert region. A Kill Bill outage changes nothing (503 `billing_unavailable`). — brief: Journeys 5, Business rules — Decline.

### 1.6 Follow and find

Share page `/s/<token>`: heading `Claim <ref>`, read-only fan with the claimed part selected, `region "Claim slip"` (state, part, ruling, edition, current quote only, promise, paid/decline line, `Claim history` disclosure collapsed). Refreshes every 30 s without a page load (scroll and focus kept); a 503 keeps the content and shows the records copy; 404/410 removes the content and shows the refusal; the next good refresh empties the alert. `/find`: reference + email → `/s/<token>`; wrong pair = one wrong try on that reference only (unknown, erased, malformed count nothing); 5 wrong tries lock for `REFERENCE_LOCK_SECONDS` (423 `reference_locked`, `Retry-After`). — brief: Journeys 6, Business rules — Find my claim.

### 1.7 Weekly upkeep

`/ops/imports`: choose the supplier CSV, `Import file` → status "Imported: n new, n updated, n unchanged, n unmatched." and `table "Unmatched rows"` (Line, Reason in mono). Same file again creates and changes nothing; an import never touches bin counts, rulings or quotes. `/ops/editions`: save code, title, start date (strictly after today's London date), months and contribution → status "Edition <code> saved. It rules claims confirmed from 00:00 on <date>."; listed by start date; saved editions never change an existing ruling. — brief: Journeys 7.

### 1.8 Erasure

`Erase owner data` opens `dialog "Erase owner data"`; `Erase everything` is enabled only while the typed text equals the reference exactly (no trim, no case change). All of the owner's claims (matched by email, any case, any state) become `{reference, state erased, erased_at}`; every other Postgres row about them is deleted; MinIO `claims/<ref>/` lists nothing; every Mailpit message whose recipient equals the address (any case) is deleted, others kept; the club roster entry is deleted; Kill Bill accounts stay (named only by reference); decided counts unchanged; MinIO or Mailpit unreachable = 503 and nothing erased. Address `/ops/claims/<ref>`, status "Owner data erased." — brief: Journeys 8, Business rules — Erasure.

## 2. Palette roles

| Role | Hex | Source |
|---|---|---|
| ground (warm slightly yellowed paper) | `#f5eedd` | brief: Visual design — Page and colour |
| surface (slip, fields, dialogs) | `#fbf7ec` | decided: a lighter sheet on the paper makes the slip a ruled card |
| ink (deep blue-black) | `#101a33` | brief: Page and colour |
| muted (captions, hints) | `#5a5444` | decided: 6.5:1 on ground for 12 px captions (WCAG 2.2 AA) |
| accent / focus (blueprint blue) | `#1f5fa8`; pressed `#184a85` | brief: Page and colour; decided: darker pressed step |
| signal (burnt orange: selected part and refusals only) | `#a64a0b` | brief: Page and colour |
| rule (warm grey hairline) | `#bfb4a0` | brief: Page and colour |
| control edge | `#857b66` | decided: 3:1 for control boundaries |
| grid | `#e3d8be` | brief: Composition (faint grid), lighter than the outlines |

## 3. Type

| Use | Face | Size | Source |
|---|---|---|---|
| headings | Space Grotesk 700 (500 for h5/h6); h1 2.441rem, h2 1.953rem, h3 1.5625rem, h4 1.25rem, h5 1rem, h6 0.8rem — each level 1.25× the one below | brief: Type |
| body | IBM Plex Sans 400/600, 1rem, line 1.55 | brief: Type |
| part numbers, booklet numbers, references, amounts, captions, import reasons | IBM Plex Mono 400/500; captions 0.75rem lower-case | brief: Type; decided: 12 px floor |

Fonts are self-hosted woff2 (latin + latin-ext) under `/fonts/`. — brief: Type (not loaded from another site). The client loads all six faces (Latin and Latin Extended) before its first render, so late fonts never reflow the slip under a pointer. — decided: DP-52/DP-56 need layout that does not move after paint.

## 4. Space and layout per viewport

| Rule | 375×812 | 768×1024 | 1280×800 | Source |
|---|---|---|---|---|
| page margin | 16 px | 24 px | 24 px | brief: Screens and layout |
| claim form | one column, fan above form | fan left 62 %, form 38 % of their combined width, gutter 40 px | same, content full width | brief: Claim form layout; decided: 62 % sits inside 60–70 % |
| confirmation | column x=16..359, full-width button ≥44 px | 560 px column centred, natural-width button aligned with the heading | same as 768 | brief: Layouts by screen |
| find | textboxes window − 32 px | 480 px column centred | same | brief: Layouts by screen |
| share page | heading, fan, slip stacked, each window − 32 px | heading then fan 62 % / slip 38 %, tops equal, gutter 40 px | content ≤ 1,200 px, centred | brief: Layouts by screen |
| workspace | one column, fan above slip; no queue pane; `link "All claims"` | two columns 62/38; no queue pane; `link "All claims"` | three columns 18 / 50 / 32 % of the pane widths, gutters 40 px; `navigation "Claim queue"` | brief: Claim workspace layout |
| dialogs | x=16..359, controls stacked, action above Cancel, full width | 480 px, centred both ways, radios stacked, action left and Cancel right on one row | same | brief: Layouts by screen |
| touch target | every control ≥ 44 px | | | brief: Accessibility |

The only layout breakpoints are 768 px and 1280 px. — brief: Screens and layout.

## 5. Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| fan parts and stage (`transform`) | slider value changes | 250 ms (settled before 300 ms) | `cubic-bezier(.22,1,.36,1)` | no transition; fan starts at 100 | brief: Motion — Exploded fitting fan |
| selected part ring and raise | a part is selected | 160 ms | same | instant | brief: Motion |
| new quote revision | a revision arrives | 220 ms slide + fade | same | instant | brief: Motion |
| dialog | open / close | 220 ms in, 160 ms out (opacity only) | same | instant | brief: Motion |
| buttons | hover, press | 120 ms (`background-color`, `color`, `transform`) | same | none | decided |

Nothing loops. Pending states show text and a still dotted rule. — brief: Motion.

## 6. Fan attributes (brief: Exploded fitting fan)

g = 48 px at 768+ and 28 px below. Part k moves round(s·k·g) px along the axis (`x` right, `y` down, `iso` 30° up-right); `data-fan-separation` = round(s·g·(n−1)); `data-fan-scale` = 1 − 0.25·s with three decimals, half up; `data-fan-axis`; `data-active-part`; each part button `data-part-offset`. Slider keys: arrows ±5, Page keys ±25, Home 0, End 100. `]` and `[` select the next and previous active part from anywhere inside the fan and leave focus where it is. Without an axis the fan is the numbered list under the heading `Diagram unavailable — choose your part from the list`.

## 7. States per async action

| Action | Pending | Success | Refused / outage | Source |
|---|---|---|---|---|
| estimate | `Asking the carrier…` (button stays enabled) | `Band <band> · <amount>` | carrier copy (alert + region) | brief: Feedback states |
| start claim | `Sending your claim…`, button disabled | address moves | field errors, per-photo messages, first message in the alert (focused) | brief: Feedback states |
| confirm / find | `Confirming…` / `Looking up your claim…` | address moves | owner refusal copy, button enabled | brief: Feedback states |
| operator action | `Working…`, every action button disabled | the operator success copy | the server's operator copy in the alert; address unchanged | brief: Operator status copy |
| page loads with no published copy | still dotted rule only (no text in a live region) | content | records / refusal copy | decided: the status region carries no other text (brief: Live regions) |
| waiting notices | — | `Notices waiting to send: <n>` while n > 0, re-read every 10 s | — | brief: Workspace waiting notices |

Exactly one `status` and one `alert` region on every page; the queue page adds `status "Decided claims"`. — brief: Live regions.

## 8. Breakpoints

768 px and 1280 px only. — brief: Screens and layout.

## 9. Services, outages and recovery

Postgres `DATABASE_URL`; MinIO `S3_*`; Kill Bill `KILLBILL_*`; Mailpit `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`; carrier `WIREMOCK_URL`. The desk starts and answers `/api/health` with every service unreachable, applies its schema as soon as Postgres answers, and retries each service on every request that needs it (no failure is remembered). Outage answers: carrier 504/503/502, MinIO 503 `storage_unavailable`, Kill Bill 503 `billing_unavailable`, Mailpit 503 `mail_unavailable` for claim start and erasure (every other action succeeds and its notice waits in the Postgres queue, sent once by whichever copy reaches Mailpit first), Postgres 503 `database_unavailable` (precedence: 405, 413, 415, 403, 401 without a cookie, then 503). — brief: Services.

## 10. Media and licences

| Asset | Origin | Licence | Source |
|---|---|---|---|
| part outlines, callouts, empty-state drawing | drawn in code (SVG) | original | decided: the brief asks for procedural outlines |
| Space Grotesk 500/700, IBM Plex Sans 400/600, IBM Plex Mono 400/500 (latin + latin-ext woff2, 12 files) | Fontsource packages, self-hosted in `public/fonts`, listed in `assets.json` with sha256 | OFL-1.1 | brief: Type |
| Lucide icons (`layers`, `chevron-down`, `chevron-up`, `arrow-left`, `check`, `triangle-alert`, `search`) | inline SVG path data | ISC | brief: Accessibility (Lucide set) |
| runtime packages | `pg`, `preact` and their dependencies | MIT, ISC | brief: IF-03 |

## 11. Disputes with the bundle's checks

None. The refreshed checks list Kill Bill invoices with `includeVoidedInvoices=true` and retry the share-page refresh in 5 s steps; the desk passes both unchanged (DP-26, DP-34, DP-67).

`test_wf_claim_start_photo_refusal` (DP-02) timed out once in the verifier at `set_input_files` with an 8,000,001-byte buffer under the 5 s default timeout, after the locator had resolved to the desk's plain `<input type="file" multiple>`. Measured locally, the same three-file call takes about 1.2 s on `/claim/new` and the same on a bare file input, so the time goes to moving the buffer from the test driver into the page, not to the desk. The test passes locally in full runs (106/106). The desk is unchanged for this.
