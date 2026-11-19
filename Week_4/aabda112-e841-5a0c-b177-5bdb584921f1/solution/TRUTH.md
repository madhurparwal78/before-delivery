# TRUTH — Roundbook, the golden's ground truth

Every value says where it comes from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the
reason ties it to the brief's intent).

## Journeys (end to end)

1. **Keyboard booking that loses a race** (brief: Journeys 1). Start: two front-desk windows on `Today` at 1280 px, free slot
   `Consult 2, 10:00, free`. Arrow keys move one slot (Up/Down) or one room (Left/Right) and the grid is one Tab stop; Enter on the free slot
   opens `Book appointment` with focus on `Client`. `Book` with no patient shows the `alert` summary (`Patient is required.` as a link to
   `Patient`, same text beside the field), nothing is sent, focus is on the summary. Meanwhile window B books the slot: window A's grid shows
   `Consult 2, 10:00, booked` live. `Book` again answers 409 `slot_taken`; the dialog's summary shows `That slot was just taken. Pick another time.` with
   focus on it. Escape closes and focus returns to the slot. Provider state: one appointment in Postgres (B's). (brief: Dialogs and focus; Error summary)
2. **Move, resize, cancel twice, undo, drag on a tablet** (brief: Journeys 2). Alt+Down moves a focused block one slot, Shift+Alt+Down
   lengthens it, Delete cancels it and focuses its first slot cell; the single `Notice` toast (`Appointment cancelled.`, `Undo`) is replaced by the
   next cancel; Undo or Ctrl+Z restores only the newest; a restore needs the server clock within `UNDO_SECONDS` of the cancel, else
   `Undo is no longer available.`. A second window follows each step without reload. At 768 px with touch a 500 ms press picks a block up
   (`data-picked="true"`), dragging moves it, release drops it on the slot under the finger; a taken slot shows the slot-taken alert. At 375 px the day is a
   `Day agenda` and the closed `Menu` drawer is absent from the DOM.
3. **Check-in, late arrival, consult, shared note** (brief: Journeys 3). `I` checks in; the row `Rex, waiting <N> min` with the chip
   `Arrived <N> min late` appears in every vet's `Waiting room` (slide-in); minutes advance with the server clock tick
   (`WAIT_TICK_SECONDS`, and at once when the grading clock is set). Two vets press `Start consult for Rex`: one wins, the loser's alert shows
   `This appointment is In consult and cannot be changed that way.` and no success announcement; the row leaves both windows and `No one is waiting.` shows.
   Two vets edit one note: different paragraphs both apply; the same paragraph answers 409 `stale_paragraph` and the later text goes into the `Draft` box.
4. **Ward round** (brief: Journeys 4). `Admit patient` with `First dose` typed as `YYYY-MM-DD HH:MM` in clinic time; doses are elapsed-hour steps
   (the October clock change keeps 8 elapsed hours). The board turns `Due` then `Overdue` as the server clock passes the time and the grace
   (`TREATMENT_GRACE_MINUTES`); the `Overdue` beacon rolls only changed digits; the announcement `Overdue now <N>. <Patient>, <Treatment> due <HH:MM>.` is made once in each window
   showing a beacon. Space marks given (announced), Shift+Space reopens, `N` and `S` open `Add note` and `Skip treatment` (blank text refused in the browser with the summary);
   dialogs, text, focus and summaries survive every refresh.
5. **Invoice, retry, void, stock batches** (brief: Journeys 5). Lines are added by keyboard; a line larger than the earliest-expiry batch draws across batches
   first-expiry-first-out, one movement per batch. A payment whose first response is lost is resent once with the same `Idempotency-Key` and pays once; an overpayment answers
   `Payment is more than the balance due.`. The manager's `Low stock count` and `Low stock` badge update live and `<Item> is low: <N> left.` is announced once per crossing,
   including a crossing caused by a batch expiring at 00:00 clinic time. Voiding an unpaid invoice needs a reason, returns each draw to its own batch and records who voided it.
6. **Pet owner on a phone, then the reminder** (brief: Journeys 6). Public page at 375 px: reason cards, `Day`, per-vet time buttons (latest choice wins, refreshed every 15 s keeping the choice and typed fields),
   `Chosen time` status, owner and pet fields, `Confirm booking` (busy, once). Mailpit holds one mail to the owner: subject `Booking confirmed: <Pet> on <Day DD Mon> at <HH:MM>`, body starting `Hello <Owner name>,`.
   At `REMINDER_HOUR` clinic time on the day `REMINDER_LEAD_DAYS` before the due date exactly one reminder is sent, the patient shows `Reminder: Sent` only after SMTP accepted it, the link opens the page for that pet until the end of the due date.
7. **Files, outage, PDFs, invitations, roles, tenancy** (brief: Journeys 7). `Files` upload goes through the app to MinIO byte for byte (key `clinics/<clinicId>/patients/<patientId>/<fileId>-<name>`),
   is listed after the put with preview, exact name and sha256, announced `<File name> saved to Files.`. With MinIO unreachable the upload answers 503 with `File storage is unavailable. Your file was not saved.`
   in the navy banner and lists nothing. History PDF lists files only with `?include=files`. The manager invites a nurse (mail with `/invite/<token>`), the nurse lands on the record page via the one-time link,
   sees `Your role cannot do that.` on invoices and the not-found page for another clinic's id; role change and removal reach open windows within the live-update limit.

## Palette roles (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | #FFFFFF | brief: Visual design (flat white); seed palette |
| warm off-white surface | #F5F5F2 | brief: Visual design; seed palette |
| input track | #EAE9E2 | brief: Forms; seed palette |
| ink / body / muted | #171717 / #262626 / #525252 | brief: Palette roles; seed palette |
| hero navy / quote navy | #00337F / #0F4FB0 | brief: Palette roles; seed palette |
| mint (primary pill) | #3AE3C0 on #171717 text | brief: Palette roles; seed palette |
| royal blue (solid button) | #0F4DAE, white text | brief: Palette roles; seed palette |
| strip blues | #99DDFF left, #1473E6 right | brief: Screen split band; seed palette |
| deep green / link green | #0F3B33 / #0B6B55 | brief: Palette roles; seed palette |
| pale mint / rose + plum ink / sky + teal-blue ink / band blue | #DCEEE8 / #EBD3E0 + #4A1B3A / #CDF3FD + #0B3B52 / #CFE3FA | brief: Palette roles; seed palette |
| focus ring | 2px #0F4DAE (on navy #99DDFF), offset 2px | brief: Pill action buttons; decided: offset per house rules |

## Type, space, shape

Plus Jakarta Sans 700/800 for headlines (56px desktop, 52px tablet, 48px phone; body 16px, so at least 3x) and DM Sans 400/500 with tabular figures for text (brief: Type). Kennel numerals 48px (at least 2.5x body)
(brief: Ward tally cards). Spacing steps 4, 8, 12, 16, 20, 24, 32, 64; content margin 64 / 32 / 24 px (seed: Layout system). Radii: pills 999, cards and blocks 12, tally cards and banners 16, row cards 8 (brief: Shape).

## Layout per viewport (brief: Screens and layout)

| Viewport | Layout |
|---|---|
| 375x812 | header is `Roundbook home` + `Open menu`; the `Menu` dialog drawer exists only while open; split band stacks navy first; `Today`: band, `Waiting room`, `Day agenda` + `Book a time`; every grid one column; tables become stacked cards; footer one column |
| 768x1024 | full header bar (wraps to two rows); band stacks; beacons in one row of three; `Waiting room` above the three-room `Day calendar`; card grids two across; footer two columns |
| 1280x800 | 50/50 split band; calendar two thirds and waiting room one third; beacons stacked in the right half; card grids three across; footer four columns |

Layout switches at exactly min-width 768 and 1100, so 375, 768 and 1280 each get their own layout (brief: no intermediate width changes which layout 375, 768 or 1280 gets).

## Motion (brief: Motion and effects)

| Name | Element | Duration, easing | Reduced motion |
|---|---|---|---|
| appointment-move | appointment button | 250 ms, 0.2, 0, 0, 1 | `none`, 0, jump |
| queue-arrive | new waiting-room listitem | 400 ms, ease-out | `none`, 0, in place |
| board-status | ward gridcell | 300 ms, ease-in-out | `none`, 0 |
| beacon-count | each beacon card, first view, 150 ms apart | 1600 ms, 0.16, 1, 0.3, 1 | `none`, 0, final numerals |
| beacon-roll | the changed digits on a push | 600 ms, 0.16, 1, 0.3, 1 | `none`, 0, never `data-rolling` |
| toast | `Notice` toast | 200 ms, ease-out | `none`, 0 |
| chip-nudge | arrow chip on hover or focus | 250 ms, ease-in-out | `none`, 0, colour only |

Attributes `data-motion`, `data-motion-ms`, `data-motion-easing` are present from the start of a motion to one second after it ends; at rest a beacon reads `idle`.

## States per async action (brief: Feedback states)

Every async button is disabled and `aria-busy` while pending and keeps its label. Successes go to the polite `Announcements` region (one child per message, oldest first, never rewritten);
errors appear as navy in-flow `alert` banners or as the dialog's own `alert` summary with links to the fields. The two server-started announcements (overdue, low stock) wait until this
window's own action has been announced. Public booking: `Chosen time` status; payments: one `Idempotency-Key` per attempt, one resend after a lost response.

## Breakpoints

375, 768, 1280 as above; switch points 768 and 1100 (decided: nearest values that give each named viewport its own layout).

## Media and licences

Nothing fetched. Illustrations, avatars, sparklines and empty-state drawings are inline SVG drawn for this app (licence `original`). Icons: Lucide (ISC), bundled. Fonts: Plus Jakarta Sans and DM Sans from
Fontsource, SIL OFL 1.1, self-hosted. Full list in `app/THIRD_PARTY_NOTICES.md`.
