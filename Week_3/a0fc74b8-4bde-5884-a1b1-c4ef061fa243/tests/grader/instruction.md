# Wickmoor Paper Co. Undersign

Undersign is a collaborative document e-signing app for small and mid-size teams, made by Wickmoor Paper Co. A sender uploads a PDF and places signature, initials, date and text fields on its pages. The sender then routes the document to recipients in a set order. Recipients do not need accounts: each one signs or declines from an emailed link. Undersign then seals the completed PDF with an appended certificate page and keeps a tamper-evident audit trail. The app is TypeScript on Node.js for both server and browser. It uses exactly three services: PostgreSQL holds every record, MinIO object storage holds every original and completed PDF, and the Mailpit mail server receives every email. These are out of scope: self-registration, member invitations by email, outside sign-in providers, billing, webhooks, AI features, fetching documents from URLs, and any datastore, queue or cache beyond those three services. The completed PDF is a tamper-evident record, not a certificate-based digital signature. Undersign makes no legal-compliance claim and never says that a document is legally binding.

## Problem and users

Office managers, operations leads and founders in teams of 3 to 60 people send contracts, onboarding packets, NDAs and vendor forms for signature every week. Incumbent tools charge per seat and cap envelopes, so teams ration seats and share one login. A shared login breaks attribution in the audit trail, and the audit trail is the team's evidence of consent, of intent, of the order of events and that nothing changed after signing. The current workarounds fail in predictable ways:

- A field placed on a scaled page lands in the wrong spot on a signer's phone.
- A second signer gets the link before the first has signed.
- A decline quietly leaves earlier signatures looking valid.
- A "completed" document turns out to have no stored sealed copy.

Undersign fixes these by storing field geometry as page fractions, letting the server alone decide whose turn it is, closing the document on a decline, and calling a document Completed only after storage confirms the sealed copy.

- **Sender** (team owner or member, daily): uploads a PDF, places and assigns fields precisely, sets the signing order, sends, and watches the status change live until the sealed copy arrives.
- **Signer** (no account, occasional): opens an emailed link on any device, reviews the document, completes only their own fields in order, then signs or declines with a reason.
- **Team owner** (weekly): sets team roles, curates shared templates and voids documents that went out wrong.
- **Viewer** (weekly): finds and reads team documents, audit trails and completed PDFs for records and disputes, and cannot send, edit or void.

## Journeys

1. **Prepare a document.** Start: a member is signed in on the documents list. They upload a three-page PDF, step through the pages, place a signature field and a date field (with the mouse or the keyboard alone), nudge and resize them, and assign them to signers. End: the editor shows every field where it was placed, and a reload shows the same fields in the same places.
2. **Route and send.** Start: a draft with fields. The sender adds three signers, moves the third one up, fixes the missing-signature warning and sends. End: only signer 1 has an invitation email, and the signing order shows signer 1 as Invited and the others as Waiting.
3. **Guided signing.** Start: signer 1 opens the emailed link on a laptop or a 375 px phone. The aperture frames their first required field. They type or draw a signature, fill text fields and move field to field with Next, Enter or Tab, then Finish and sign. End: the link page says they signed and names who is next. Within 3 seconds the sender's page shows signer 1 Signed and signer 2 Invited.
4. **Completion.** Start: the last signer's turn. They sign. End: the document shows Sealing until the sealed PDF is stored, then Completed. Every party gets one completed email with the SHA-256 of the completed PDF. The downloaded file's hash matches, and its last page is the certificate.
5. **Decline or void.** Start: a document in progress. The current signer declines with a reason, or the sender voids it with a reason. End: every outstanding link shows the published declined or voided page. Earlier signatures show as not binding. Only the sender and the people who already signed (plus, on a void, the person whose turn it was) get a notice.
6. **Outages and expiry.** Start: email is down, or a link's time runs out. Invitations show Not delivered yet, and the sender sees the email banner. An expired link shows the expired page, the sender sees Link expired live, and Send a new link mails a fresh link. End: the new link works and the old one stays expired.
7. **Team and templates.** Start: an owner and a member are signed in, each in their own browser. The owner saves a draft as a template and shares it, the member creates a draft from it, and the owner makes the member a viewer. End: the member's open page shows the role banner and loses its upload and edit controls within 3 seconds. Another team's document answers Document not found.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Upload and page view** A sender uploads a PDF with Upload PDF and gets a draft whose original is stored byte for byte, whose `originalSha256` matches the file and whose every page shows as a `Page <n> of <count>` group with its own filmstrip button.
- **DP-02 — Page navigation** The filmstrip moves between pages with ArrowUp, ArrowDown and Enter, and at 768 px wide and narrower a `Page` combobox replaces it, with no sideways scroll at any width.
- **DP-03 — Upload refusals and limits** Uploads are judged by their bytes and refused with the published status, body and alert for non-PDFs, password-protected, scripted, rotated, over-60-page and over-25,000,000-byte files, storing nothing and returning focus to Upload PDF.
- **DP-04 — Placing fields by pointer and touch** Dragging a field button from the Fields toolbar onto a page, or on a touch screen tapping the button then the page, creates a field centred on the drop or tap point, clamped inside the page.
- **DP-05 — Placing fields by keyboard** Enter or Space on a Fields toolbar button creates a default-size field centred on the current page, selects and focuses it, and announces its position in the Field position region.
- **DP-06 — Field properties** Selecting a field opens the Field properties panel, whose Assign to, Required and Label controls work by keyboard and change the field's stored values and accessible name.
- **DP-07 — Page-fraction geometry** Every field is stored once as page fractions and renders within 0.01 of them in the editor, the signer view and after reload at 375, 768 and 1280 px wide.
- **DP-08 — Moving and resizing by pointer** Dragging a field moves it by the drag distance as a page fraction and dragging its Resize handle changes its width and height, both clamped inside the page and above the minimum size.
- **DP-09 — Keyboard move, resize, page change and delete** Arrow, Shift+Arrow, Alt+Arrow, PageDown, PageUp, Delete and Escape act on the selected field with the published steps, saving each change and announcing the new position.
- **DP-10 — Team-scoped records** Every document, template, field, recipient and audit route answers 404 for another team's ids, including ids inside request bodies, and lists only the caller's team.
- **DP-11 — Signing order editing** Senders add signers by keyboard, reorder them with Move up and Move down buttons that keep focus on the moved row, and hear the new position announced.
- **DP-12 — Send checks** Sending is refused with the published missing-signature copy until every signer has a required signature field, and the Send for signing dialog keeps focus inside and returns it on Escape.
- **DP-13 — Turn hand-off** After sending, only signer 1 is invited; when signer 1 signs, signer 2's invitation arrives and the sender's Signing order list shows Signed and Invited without reload.
- **DP-14 — Single-line mail headers** Line breaks in a document title or a sender's name never add mail headers or recipients; each run of them becomes one space in the subject and From name.
- **DP-15 — Send replay and races** A repeated send with the same Idempotency-Key returns the first response, and of simultaneous sends or signatures exactly one takes effect.
- **DP-16 — Aperture on open** When a signer opens their turn, the aperture frames their first required field within 0.01 of its box, everything else dims, focus enters the field and the Signing progress region announces it.
- **DP-17 — Next and Previous walk** Next, Enter in a completed field and Tab out of a completed field move the aperture and scroll to the next incomplete required field in about 0.3 to 0.45 seconds, update the count and announcement, and jump without in-between frames under reduced motion, as qualified in Interactions.
- **DP-18 — Finish check** Finish and sign with incomplete required fields shows the published alert and moves the aperture back to the first incomplete field; with all complete it signs.
- **DP-19 — Server-decided turns and expiry** A signing link's state comes only from the server's signing order and expiry and is enforced on every request, whatever the device clock says.
- **DP-20 — Adopt dialog** Activating a signature or initials field opens the Adopt dialog with Type and Draw tabs switched by Arrow keys, focus kept inside, and Escape returning focus to the field.
- **DP-21 — Typed and drawn signatures** A typed adoption stores `typed:<text>`, a drawn one stores `drawn`, Adopt and sign stays disabled until there is text or a stroke, and later fields of the same kind fill with one activation.
- **DP-22 — Text field limit** Signer text fields accept at most 200 characters counted as Unicode code points and show the live character counter.
- **DP-23 — Signing on a phone** At 375 by 812 with touch, a signer reads the page at full width, taps a signature field, draws and adopts, taps Finish and sign and sees the you-signed state.
- **DP-24 — Touch signature pad** Drawing on the signature pad with touch leaves the page scroll position unchanged, and the dialog fits a 375 px wide screen.
- **DP-25 — Decline dialog** The Decline to sign dialog requires a reason of 1 to 500 characters with a live counter and the published empty-reason error, and works fully by keyboard.
- **DP-26 — Decline closes the document** A decline sets the document to Declined, marks earlier signatures not binding, shows the reason to the sender live, and notifies only the sender and earlier signers.
- **DP-27 — Void** The document's owner or a team owner can void an in-progress document with a reason, which closes it like a decline, while anyone else is refused.
- **DP-28 — Closed links** After a decline, void, expiry or replacement, a signing link can no longer read the PDF, fill fields, sign or decline, and shows its published state page instead.
- **DP-29 — Documents table** The documents list shows each document's published Status and Next step words, filters by keyboard-operated tabs and becomes a card list at 375 px with the same texts.
- **DP-30 — Live row updates** Status and Next step change on open lists and document pages within 3 seconds of the server change, with the Document updates announcement.
- **DP-31 — Reminders** A sender can remind the current signer at most once per cooldown; the button then shows the server's next-available time and the API answers 429.
- **DP-32 — Completion journey** Two signers sign in turn from their emailed links, the waiting signer's page turns to the completed state live, and every party can download the same completed PDF.
- **DP-33 — Completed only after storage confirms** A document becomes Completed and completed emails go out only after the sealed PDF is confirmed stored; while storage is down it stays Sealing, and the main instance retries and seals it within the published retry window, as qualified in Business rules.
- **DP-34 — Completed PDF and certificate** The completed PDF is the original pages with field values plus one certificate page carrying the published lines, and its SHA-256 equals `completedSha256`.
- **DP-35 — Completed emails** Each party receives exactly one completed email carrying the SHA-256 line and a download link.
- **DP-36 — Hash-chained audit trail** Every state change writes one audit event whose hash chains to the previous one, shown on the Audit trail page.
- **DP-37 — Held invitations** While email is unavailable, invitations are held and shown as Not delivered yet with the email banner, and the main instance, whose email and storage both work, delivers each held invitation exactly once by its retry no sooner than the retry interval after it was held, as qualified in Services.
- **DP-38 — Link expiry and new links** A link expires the configured time after its turn begins, the sender sees Link expired live, and Send a new link mails a working link while the old one stays expired.
- **DP-39 — Signer link pages** Each signing-link state shows its published heading and body word for word and switches live within 3 seconds when the state changes.
- **DP-40 — Roles and permissions** Owners, members and viewers each see only the controls their role allows, and the API answers 403 for actions their role lacks.
- **DP-41 — Live role change** When an owner changes a member's role, the member's open pages show the role banner and drop controls the new role lacks within 3 seconds.
- **DP-42 — Templates** An owner saves a draft as a template and shares it, a member creates a draft from it with the same fields at the same fractions, and a retired template disappears from members' lists live.
- **DP-43 — Return after sign-in** A signed-out visit to a team page goes through sign-in and back to that page, and any return path that is not a same-origin path goes to the documents list.
- **DP-44 — Panel and sheet motion** The Field properties panel and the phone Signing order sheet slide in over about 0.3 seconds, reverse from mid-slide without a jump when closed, and change instantly under reduced motion.
- **DP-45 — Accessible at every width** The documents list, editor and signer view have no axe-core WCAG 2.2 A and AA violations at any impact level, visible focus, tap targets at least 44 px (placed field boxes and resize handles excepted) and no sideways scroll at 375, 768 and 1280 px.
- **DP-46 — Ledger-paper look** Screens use the warm paper ground, ink text, hairline rules, a single seal red reserved for signature actions and the active field, and the published type faces.
- **DP-47 — Self-contained serving** The app serves its health route, fonts, page renderer and assets from its own origin, makes no browser request to another origin, and never serves source files or credentials.
- **DP-48 — Configuration from environment** Every service address, credential and timer is read from the published environment variables at start and never written into source or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-02, DP-23, DP-29, DP-45)

Every screen fits 375x812, 768x1024 and 1280x800 with no sideways scroll of the page body. Text never needs sideways scrolling to read.

- **Sign-in** (`/sign-in`): one centred column with email, password and the Sign in button.
- **App frame** (every signed-in page): a top bar with the product name, the main navigation and Sign out. At 375 px the navigation wraps under the product name.
- **Documents** (`/documents`): the page heading `Documents`, the Upload PDF control and title box, the status filter tabs, then the documents table. At 375 px the table is replaced by a list of cards. Each card shows the same Title, Status, Next step and Updated texts stacked.
- **Document page** (`/documents/<id>`): one route for the draft editor and the sent document. The heading is the document title. The status word and Next step text (from Feedback states) sit beside it.
  - 1280 px: three panes. A filmstrip of page thumbnails on the left. In the centre, the pages stacked top to bottom on a paper ground, with the Fields toolbar above them (drafts only). On the right, the routing column: the numbered signing order joined by a single vertical hairline, the add-signer form, the time zone picker and the send, reminder and void controls. When a field is selected, the Field properties panel slides in over the right edge of the routing column.
  - 768 px: the filmstrip becomes the `Page` combobox above the pages. The routing column stays on the right at a narrower width.
  - 375 px: the page fills the width. The routing column becomes a bottom sheet opened by the `Signing order` button. The Field properties panel rises from the bottom as a sheet.
  - Each page keeps its PDF aspect ratio at every width and browser zoom level. At 100% browser zoom a page is exactly as wide as the centre column.
  - Closed documents (Completed, Declined, Voided) show the outcome banner from Feedback states above the pages. Completed documents also show `Completed PDF SHA-256` with the hash in mono type and the download link.
- **Audit trail** (`/documents/<id>/audit`): the heading `Audit trail`, the audit table and, for completed documents, `Completed PDF SHA-256` with the hash. At 375 px the table's Hash column wraps under the event row instead of widening the page.
- **Templates** (`/templates`): the heading `Templates` and the template list. Each item shows the name, its signer and field counts and, for owners, its state word.
- **Team** (`/team`): the heading `Team` and the members table: Name, Email, Role.
- **Signer link page** (`/sign/<token>`, no sign-in): when it is the signer's turn, the signing view. Otherwise a single centred notice with the state heading and body from Feedback states.
  - The signing view has a sticky header (title, count, Previous, Next, Finish and sign, Decline) and the pages stacked below it.
  - At 1280 px the pages sit in a centred column no wider than a comfortable reading width, and the header spans the window.
  - At 768 px the page fills the column with a narrow margin.
  - At 375 px the page fills the width, and the header controls wrap onto two rows, each control at least 44 px tall.
- **Not found** (any unknown app path, or another team's document): the heading and body from Feedback states.

### Public screens and controls (DP-01, DP-04, DP-05, DP-06, DP-11, DP-12, DP-16, DP-20, DP-25, DP-29, DP-40, DP-42)

Only the roles, names and ids below are public. Everything else is up to you. Unless a row says otherwise, visible text matches the accessible name. Copy for statuses, banners, errors and announcements is owned by Feedback states.

| Screen | Role and accessible name | Notes and visible copy |
|---|---|---|
| Sign-in | `textbox "Email"`, password input labelled `Password`, `button "Sign in"` | |
| App frame | `navigation "Main"` with `link "Documents"`, `link "Templates"`, `link "Team"`; `button "Sign out"` | |
| Documents | `heading "Documents"` level 1; `button "Upload PDF"` (opens the file chooser); `textbox "Title"` | Title defaults to the chosen file's name without `.pdf`. Upload PDF is absent for viewers. |
| Documents | `tablist "Status filter"` with `tab "All"`, `tab "In progress"`, `tab "Completed"`, `tab "Declined or voided"` | Roving focus: one tab in the Tab order, Arrow keys move and select |
| Documents | `table "Documents"` with column headers `Title`, `Status`, `Next step`, `Updated`; each title is a `link` to the document page | At 375 px: `list "Documents"` of `listitem` cards with the same texts |
| Documents and document page | `status` region `Document updates`; `status` region `Service notice` | Announcements and banners from Feedback states |
| Document page | `heading` level 1 with the document title | |
| Document page | `navigation "Pages"` with `button "Page <n>"` per page | The current page's button has `aria-current="page"`. Absent at 768 px and narrower. |
| Document page | `combobox "Page"` with options `Page <n> of <count>` | Shown at 768 px and narrower only |
| Document page and signer view | `group "Page <n> of <count>"` with id `page-<n>` (1-based), focusable | Holds the page image (decorative, empty alt text) and every field on that page |
| Document page (draft) | `toolbar "Fields"` with `button "Signature"`, `button "Initials"`, `button "Date"`, `button "Text"` | On touch screens an armed button has `aria-pressed="true"`. Absent for viewers and on sent documents. |
| Document page | Field: `button "<label> for <recipient name>"`, id `field-<fieldId>` | `aria-pressed="true"` when selected. Shows the label and the recipient's name inside a washed box. |
| Document page | `button "Resize <label>"` at the selected field's bottom-right corner | Pointer handle only; not in the Tab order |
| Document page | `complementary "Field properties"` with `combobox "Assign to"` (options: signer names in order), `checkbox "Required"`, `textbox "Label"`, `button "Close"` | Open only while a field is selected |
| Document page | `status` region `Field position` | |
| Document page | `list "Signing order"`; each `listitem` reads `<order>. <name>` followed by its row status word and holds `button "Move <name> up"`, `button "Move <name> down"`, `button "Remove <name>"` (drafts only) | After a decline or void, signed rows also read `Not binding` |
| Document page | `textbox "Name"`, `textbox "Email"`, `button "Add signer"` | Drafts only. Enter in Email adds. |
| Document page | `combobox "Time zone"` with IANA zone names | Drafts only. Default `UTC`. |
| Document page | `status` region `Signing order updates` | |
| Document page | `button "Signing order"` | 375 px only. Opens `dialog "Signing order"`, the bottom sheet holding the routing column. |
| Document page | `button "Send for signing"`, then `dialog "Send for signing"` listing `<order>. <name> (<email>)` per signer, with `button "Send"` and `button "Cancel"` | Drafts only |
| Document page | `button "Send reminder"` | In progress only, while the current recipient is invited or viewed. It is absent while that recipient's link is expired. While cooling down it is disabled and its text and name become the cooldown copy. |
| Document page | `button "Send a new link"` | Inside an expired signer's row only |
| Document page | `button "Void document"`, then `dialog "Void document"` with `textbox "Reason"`, `button "Void"`, `button "Cancel"` | In progress only, for the document's owner and team owners |
| Document page | `button "Save as template"` | Drafts only, owners only |
| Document page | `link "Audit trail"`; `link "Download completed PDF"` | The download link is shown on completed documents only |
| Document page | `heading "Pages can't be shown right now"` and `list "Fields"` | Shown when the pages can't load. The list has one item per field: `<label> for <recipient name>, page <n>`. |
| Audit trail | `heading "Audit trail"`; `table "Audit trail"` with columns `#`, `Event`, `By`, `Time (UTC)`, `Hash` | Event shows the event type verbatim. Time shows `YYYY-MM-DD HH:MM:SS`. Hash shows the first 12 hex characters, with the full hash as the cell's tooltip (HTML title attribute) |
| Templates | `heading "Templates"`; `list "Templates"`; per item `button "Use template"`, and for owners `button "Share <name>"` (draft) and `button "Retire <name>"` (shared) | Item state words `Draft`, `Shared`, `Retired` are shown to owners |
| Templates | `dialog "Use template"` with `textbox "Name for Signer <k>"` and `textbox "Email for Signer <k>"` per placeholder, `button "Create draft"`, `button "Cancel"` | |
| Team | `heading "Team"`; `table "Members"`; owners see `combobox "Role for <name>"` with options `Owner`, `Member`, `Viewer` | Others see the role as text |
| Any signed-in page | `status` region `Account notice` | |
| Signer view | `heading` level 1 with the document title; text `<n> left`; `button "Previous"`, `button "Next"`, `button "Finish and sign"`, `button "Decline"` | `<n>` counts this signer's incomplete required fields that are not date fields |
| Signer view | This signer's signature and initials fields: `button "<label>"`. Text fields: `textbox "<label>"`. Date fields: `textbox "<label>"` with `aria-readonly="true"` and visible text `Filled when you sign`. All have id `field-<fieldId>` | Other signers' fields are unlabelled outlines with no role |
| Signer view | Element with id `aperture`, hidden from assistive tech | The aperture frame |
| Signer view | `status` region `Signing progress`; `status` region `Document status` | |
| Signer view | `dialog "Adopt your signature"` or `dialog "Adopt your initials"` with `tablist` containing `tab "Type"` and `tab "Draw"`; Type panel: `textbox "Full name"` (or `textbox "Initials"`); Draw panel: `img "Signature pad"` and `button "Clear"`; `button "Adopt and sign"`, `button "Cancel"` | |
| Signer view | `dialog "Decline to sign"` with `textbox "Reason"`, `button "Decline"`, `button "Cancel"` | |
| Signer link page (closed states) | `heading` level 1 and body text from Feedback states; `link "Download completed PDF"` when completed | |

### Interactions (DP-02, DP-04, DP-05, DP-06, DP-08, DP-09, DP-11, DP-12, DP-16, DP-17, DP-18, DP-20, DP-21, DP-24, DP-25)

**Keyboard rule for the whole app.** Every action has a keyboard path. In every dialog and sheet, Tab and Shift+Tab cycle through that dialog's controls and never reach the page behind it. Escape closes the dialog, and focus returns to the control that opened it. Focus is always visible as a 2 px ink ring with a gap from the control.

**Pages.** In `navigation "Pages"`:

- ArrowDown and ArrowUp move focus between page buttons.
- Enter makes the focused page current. The pages scroll to it and focus moves to its `page-<n>` group.
- Choosing an option in `combobox "Page"` does the same.
- Scrolling the pages makes current whichever page crosses the vertical middle of the viewport.

**Field editing.** Each pointer action has a keyboard equivalent. Steps are fractions of the page. A field never leaves its page and never shrinks below the minimum size from Business rules.

| Action | Pointer or touch | Keyboard |
|---|---|---|
| Place a field | Press a toolbar button, drag onto a page and release: the field is centred on the release point at its default size, then clamped inside the page. A click without dragging acts like Enter. On a touch screen: tap a toolbar button (it shows `aria-pressed="true"`), then tap a page; tapping the armed button again disarms it | Enter or Space on a toolbar button creates the field centred on the current page at its default size, selected and focused |
| Select | Click or tap the field | Focusing a field selects it |
| Move | Drag the field body: it moves by the drag distance, converted to page fractions. Releasing over another page moves it to that page at the release point | Arrow keys move the selected field by 0.005; Shift+Arrow moves it by 0.05 |
| Resize | Drag `button "Resize <label>"` | Alt+ArrowRight / Alt+ArrowDown grow width / height by 0.005; Alt+ArrowLeft / Alt+ArrowUp shrink; with Shift added, by 0.05 |
| Move to another page | Drag onto another page | PageDown / PageUp move the field to the next / previous page at the same fractions, and focus follows it. Nothing happens on the last / first page |
| Delete | none | Delete or Backspace removes the field. Focus moves to the next field on the page, otherwise to the page group |
| Deselect | Click empty page area | Escape deselects, closes Field properties and focuses the page group |
| Reorder signers | Drag a row by its handle | `Move <name> up` / `Move <name> down`. Focus stays on the pressed button in the moved row. If that button becomes disabled (the row reached the top or bottom), focus moves to the row's other move button |
| Draw a signature | Draw on the pad | `tab "Type"` in the adopt dialog |

The field shortcuts in the table work while focus is on the selected field. While focus is in a Field properties textbox, keys edit the text instead. After every keyboard move, resize or page change, the `Field position` region announces the position copy from Feedback states. Every change saves automatically; there is no Save button.

Adding a signer:

- Fill `textbox "Name"` and `textbox "Email"`, then press Enter in Email or press Add signer.
- Focus returns to Name, and the new row appears at the end of the order.
- Removing a signer also removes their fields.

The field-kind toolbar buttons are disabled until the document has a signer. A new field is assigned to signer 1, and `combobox "Assign to"` changes that. Changing `textbox "Label"` saves on each change, and the field's accessible name follows within the same second.

**Send.** `Send for signing` opens its dialog, and `Send` sends. On success the dialog closes and focus moves to the document heading. On refusal the dialog stays open with the error inside it.

**Signer view and the Aperture walk.**

1. When a signer opens their turn, the page scrolls so their first incomplete required field's top sits between 30% and 40% of the viewport height (or as close as the scroll range allows). The aperture frames that field, everything else dims, focus moves into the field, and `Signing progress` announces it.
2. The walk visits the signer's incomplete required fields, except date fields, in reading order: page, then top edge, then left edge.
3. **Next** moves to the next incomplete required field after the current one, wrapping to the first. These all count as Next:
   - pressing `button "Next"`;
   - pressing Enter while focus is in a completed current field;
   - pressing Tab while focus is in a completed current field and another incomplete required field remains.

   In every other case, Tab follows the normal order: the signer's fields in reading order, then the header controls. **Previous** goes back the same way.
4. On each move, the aperture travels from the current field's box to the next field's box. The page scrolls in the same span so the next field's top lands between 30% and 40% of the viewport height (or as close as the scroll range allows). Focus moves into the field, and the announcement repeats.
5. If focus lands on any of the signer's fields by click, tap or Tab, that field becomes current and the aperture moves to it. Optional fields can be reached this way and are announced with the optional-field copy.
6. `<n> left` updates when a value is saved:
   - a signature or initials field on adoption;
   - a text field when focus leaves it or Next is pressed;
   - a text field counts as complete when it holds at least one character other than spaces.
7. When no incomplete required field remains and the signer presses Next, the aperture moves onto `button "Finish and sign"`, focus moves to that button and the count reads `0 left`.
8. Scrolling the page by hand never detaches the aperture from its field. It scrolls with the field.
9. `Finish and sign` with incomplete required fields shows the incomplete-fields alert. The aperture moves to the first incomplete field and focus follows it. With all required fields complete, it signs, and the page switches to the signed state.

**Adopt dialog.**

- Click, tap, Enter or Space on an empty signature or initials field opens `Adopt your signature` or `Adopt your initials`, with `Type` selected.
- `Full name` is prefilled with the recipient's name. `Initials` is prefilled with the first letter of each word of the name, in capitals: `Ada Byrne` gives `AB`.
- Arrow Left and Arrow Right switch tabs.
- In `Draw`, drawing with mouse, pen or touch makes strokes on the pad. Drawing never scrolls or zooms the page, and the page's scroll position is unchanged after a touch drag on the pad. `Clear` empties the pad.
- `Adopt and sign` is disabled until the active tab has a typed value or at least one stroke.
- Adopting fills the field and closes the dialog, and focus returns to the field.
- Once adopted, each later empty field of the same kind for this signer fills on one activation without the dialog.
- Space on a filled signature or initials field reopens the dialog to change it. Enter on a filled one acts as Next.
- At 375 px the dialog is no wider than the screen and its pad is at least 140 px tall.

**Decline.** `Decline` opens `Decline to sign`. Typing in `Reason` updates the counter. The 501st character is not accepted into the box. Pressing `Decline` with an empty reason shows the error under the box and keeps focus in it.

**Touch.** Every control works by tap. No action needs hover or a long press.

### Visual design (DP-46, DP-45)

- **Colour roles:**
  - Ground: a warm off-white like ledger paper.
  - Text and lines: a deep blue-black ink.
  - Rules and dividers: hairlines of a soft greyish tan, a single pixel wide.
  - Fields: a pale parchment wash, with a thin ink frame.
  - Seal red: one vermilion, the only accent colour, used only for signature-bearing actions (`Send for signing`, `Send`, `Adopt and sign`, `Finish and sign`), for the active field's frame and for the aperture.
  - Errors use ink text with a seal-red rule beside them, never a second red.
- **Type:** Fraunces, a soft high-contrast serif, for headings and the document title. Public Sans for body text and controls. IBM Plex Mono for hashes, timestamps and position read-outs. Each heading level is a quarter larger than the one below it, starting from body text.
- **Density and depth:** comfortable spacing, with roughly a line of body text between grouped controls. Cards and panels have no shadows; depth comes from hairline rules and the single dimming layer of the signing view.
- **Composition:**
  - Pages sit on the paper ground like sheets on a desk.
  - The routing column is a numbered list joined by one vertical hairline. Each signer's number sits in a small ink circle, and a signed signer's circle fills with seal red.
  - Every toolbar, header, navigation, dialog, list-row and form control is at least 44 px in both directions at 375 px. Placed field boxes (in the editor and the signer view) and the `Resize <label>` handle are exempt, because their size follows the stored page fractions.
- **Contrast:** all text and control boundaries meet WCAG 2.2 AA contrast against the paper ground, including seal red text on paper and paper text on seal red.

### Motion and effects (DP-17, DP-44, DP-16)

Every motion has one meaning. Motion starts quickly and settles softly.

- **Aperture travel (state change):**
  - The aperture's frame moves its position, width and height from the current field's box to the next field's box over 0.3 to 0.45 seconds. Sampled during that time, its box passes through in-between positions.
  - The page scroll runs in the same span.
  - Previous runs the same motion in reverse, from the current field back to the previous one.
  - When the aperture lands, its box matches the field's box within the tolerance in Business rules.
- **Count roll (progress):** when `<n> left` drops, the old numeral rolls down and out as the new one rolls in, in about a fifth of a second.
- **Dimming layer (enter):** fades in over about a third of a second when the signing view opens. Everything except the aperture's field dims to about 40 percent strength. The aperture frame is a rounded rectangle with a 2 px seal-red edge.
- **Field properties panel and the 375 px Signing order sheet (enter and exit):**
  - The panel slides in from the right edge. The sheet rises from the bottom edge. Each takes about 0.3 seconds, from 0.25 to 0.35 seconds.
  - Closing either one mid-slide reverses it from wherever it is, with no jump.
  - It ends fully hidden and stays hidden: no flash back into view and no later hide.
- **Press feedback:** buttons darken slightly while pressed. There is no other hover or press motion.
- **No loops:** no spinners, pulsing or other repeating animation anywhere. Pending states are shown statically, as described in Feedback states.
- **Reduced motion:** when the system asks for reduced motion:
  - The aperture and the page scroll jump straight to the next field with no in-between frames.
  - The count swaps without rolling.
  - The dimming appears at once.
  - The panel and sheet appear and disappear at once.

  The dimming, the aperture frame, the count, the focus move and every announcement stay exactly as they are.
- All screen timing runs on the browser's own timers and animation frames. The verifier pauses and advances the browser clock to sample motion.

### Feedback states (DP-03, DP-12, DP-18, DP-22, DP-25, DP-26, DP-29, DP-30, DP-31, DP-37, DP-38, DP-39, DP-41, DP-43)

All copy below renders character for character: straight apostrophes (U+0027), straight double quotes, the same case, digits and punctuation. Every announcement built from it carries the same characters.

Placeholders used throughout the brief:

- `<title>`: the document title.
- `<name>`: a recipient's name.
- `<k>`: a recipient's `order`.
- `<n>`: the number of recipients (or of fields, where stated).
- `<sender name>`: the document owner's name.
- `<reason>`: the reason given.
- `<Role>`: `Owner`, `Member` or `Viewer`.
- `<label>`: a field's label.
- `<p>`: a page number.

**Status words** (documents table, cards, document page): `Draft`, `In progress`, `Sealing`, `Completed`, `Declined`, `Voided`.

**Next step** text, decided by the server:

| Document state | Next step |
|---|---|
| draft | `Add signers and fields` |
| in progress, current recipient's link expired | `Link expired for <name>` |
| in progress, current recipient's invitation held | `Invitation not delivered yet to <name>` |
| in progress, otherwise | `Waiting for <name> (<k> of <n>)` |
| sealing | `Sealing the completed PDF` |
| completed, declined, voided | `None` |

**Signing order row status words:**

| Recipient status | Row word |
|---|---|
| waiting | `Waiting` |
| invited, delivery sent | `Invited` |
| invited, delivery held | `Not delivered yet` |
| viewed | `Viewed` |
| signed | `Signed` |
| declined | `Declined` |
| expired | `Link expired` |

**Document outcome banners:** a declined document shows `<name> declined: <reason>`. A voided document shows `Voided by <voider name>: <reason>`.

**Announcements:**

- `Document updates`: `<title>: <status word>` whenever a shown document's status changes.
- `Field position`: `<label>: page <p>, x <x>, y <y>, width <w>, height <h>`, each number to 3 decimals. For example: `Signature 1: page 2, x 0.350, y 0.470, width 0.300, height 0.060`.
- `Signing order updates`:
  - after a reorder: `<name> is now signer <k> of <n>`;
  - after send: `Sent for signing. <name> has the first turn.`;
  - after a new link: `New link issued for <name>.`
- `Signing progress`:
  - required field: `Field <i> of <n>: <label>, page <p>`. `<i>` is the field's place among the signer's required non-date fields in reading order, and `<n>` is their total.
  - optional field: `Optional field: <label>, page <p>`.
- `Document status` (signer link page): the new heading text whenever the state changes live.
- `Account notice`: `Your role is now <Role>.`

**Pending, success and error per action.** While an action is pending, its button is disabled and marked busy, its text does not change, and the listed region announces the pending copy.

| Action | Pending (region) | Success | Errors (shown as `alert` unless stated) |
|---|---|---|---|
| Upload PDF | `Uploading <file name>...` (`Document updates`) | Opens the new draft's document page | Upload refusal copy below. Focus returns to `Upload PDF` |
| Send | `Sending...` (`Signing order updates`) | Send announcement above | `Every signer needs a signature field. Missing: <names in signing order joined with ", ">` in the dialog |
| Send reminder | `Sending reminder...` (`Signing order updates`) | `Reminder sent to <name>.` (`Signing order updates`) | Cooldown text below; mail outage: `Email is unavailable. Try the reminder again later.` |
| Send a new link | `Issuing a new link...` (`Signing order updates`) | New-link announcement above | |
| Void | `Voiding...` (`Signing order updates`) | Voided banner | Empty reason: `Enter a reason for voiding.` under the box |
| Finish and sign | `Signing...` (`Signing progress`) | Signed state page | `Complete <n> required fields first.` |
| Decline | `Declining...` (`Signing progress`) | Decliner's declined page | Empty reason: `Enter a reason for declining.` under the box |
| Sign in | none | Goes to the return page | `Email or password is incorrect.` |
| Role change | none | Role combobox shows the new role | `A team needs at least one owner.` |
| Add signer and template signers | none | Row added / draft opened | Under the box: the `name`, `email`, `recipients` or `signers` copy from Validation copy below |
| Any other failure | | | `Something went wrong. Try again.` |

**Reminder cooldown text:** while a reminder is not yet available, `button "Send reminder"` is disabled and reads `Next reminder after <YYYY-MM-DD HH:MM> <time zone>`. The time is `reminderAvailableAt` converted to the document's time zone, and `<time zone>` is the IANA name, for example `Europe/London`. It becomes `Send reminder` again within 3 seconds of the server's `reminderAvailableAt` passing.

**Upload refusal copy** (by error code from API):

- `not_a_pdf`: `That file is not a PDF.`
- `pdf_encrypted`: `Password-protected PDFs can't be uploaded.`
- `pdf_has_scripts`: `PDFs with scripts can't be uploaded.`
- `pdf_rotated`: `Rotated pages aren't supported. Upload a PDF with upright pages.`
- `too_many_pages`: `This PDF has more than 60 pages.`
- `too_large`: `This PDF is larger than 25 MB.`
- `storage_unavailable`: `File storage is unavailable. Your PDF was not uploaded.`

**Field limit counters:**

- text field counter: `<n> of 200 characters`;
- decline and void reason counter: `<n> of 500 characters`.

**Validation copy.** Each key in a `422 validation` body carries exactly one copy listed for that key. Where a key lists more than one, the first failing check in the listed order wins.

| Key | Copy, in check order |
|---|---|
| `title` | `Enter a title of 1 to 120 characters.` |
| `timeZone` | `Choose a valid time zone.` |
| `file` | `Choose a PDF to upload.` |
| `name` | `Enter a name.` |
| `email` | `Enter a valid email address.`, then `This email is already a signer on this document.` |
| `recipients` | `A document can have at most 10 signers.` |
| `kind` | `Choose signature, initials, date or text.` |
| `label` | `Enter a label of 1 to 40 characters.` |
| `geometry` | `Fields must lie inside the page and be at least 0.02 by 0.02.` |
| `value` | `Text can be at most 200 characters.` |
| `typed` | `Enter 1 to 100 characters.` |
| `strokes` | `Draw at least one stroke of at most 5,000 points.` |
| `reason` | the empty-reason copy of the Void or Decline row in the action table above, then `Reason can be at most 500 characters.` |
| `signers` | `Enter a name and a valid email address for every signer.` |

`POST /api/grading/setup` validation copy is free; tests check only its 422 status there.

**Signer link page states.** Each state is a level 1 `heading` plus body text, decided by the server:

| State (`state` in API) | Heading | Body |
|---|---|---|
| `your_turn` | `<title>` | The signing view |
| `signed_waiting` | `You signed <title>` | `Waiting for <name> (signer <k> of <n>).` naming the recipient whose turn it is |
| `sealing` | `You signed <title>` | `Your signature is recorded. The completed PDF will be emailed once it is sealed.` |
| `completed` | `<title> is complete` | `Everyone has signed.` and `link "Download completed PDF"` |
| `declined` | `This document was declined` (the recipient who declined sees `You declined this document`) | `<name> declined to sign. No further signatures are needed.` |
| `voided` | `This document was voided` | `<sender name> voided it: <reason>` |
| `expired` | `This link has expired` | `Ask <sender name> to send a new link.` |
| unknown token | `This link is not valid` | `Check that you copied the whole link.` |

**Not found:** `Document not found` heading with body `Check the link, or ask your team owner.` This covers unknown and other teams' documents and templates, and any unknown app path.

**Outages:**

- Email unavailable: the `Service notice` region on the documents list and document pages shows `Email is unavailable. Invitations are held and sent when email recovers.`
- Storage unavailable: the same region shows `File storage is unavailable. New uploads are paused and completed PDFs are sealed when it recovers.`
- A document or signing view whose pages can't load shows the heading `Pages can't be shown right now` with the body `File storage is unavailable. Your document and its fields are safe.`

## Backend

### API (DP-01, DP-03, DP-10, DP-15, DP-19, DP-21, DP-22, DP-25, DP-28, DP-31, DP-34, DP-36, DP-40, DP-47)

All bodies are JSON (`application/json`, UTF-8), except the upload, which is `multipart/form-data`, and PDF downloads, which are `application/pdf`. Character counts are Unicode code points, so an emoji such as 🖋 counts as one. Every error body has the shape `{"error": "<code>"}`, plus only the extra keys a row names. Validation errors are `422 {"error": "validation", "fields": {"<key>": "<copy>"}}`, with one entry per failing key, where `<copy>` is that key's copy from Validation copy in Feedback states.

**Error precedence (whole API):**

1. 413 for an oversized body.
2. 401 `{"error": "unauthenticated"}`.
3. 404 `{"error": "not_found"}` for an unknown id or another team's id, including ids inside request bodies.
4. An idempotent replay returns its stored response here.
5. 403 `{"error": "forbidden"}` for a role or ownership that does not allow the action.
6. 409, then 429, for state conflicts: a request that breaks a state rule answers 409 even while a cooldown is running.
7. 422 for validation.
8. 503 `{"error": "storage_unavailable"}` or `{"error": "mail_unavailable"}` only when everything else passes and a needed service is unreachable.

Rows below list only their own extra errors.

**Document JSON** (`GET /api/documents/<id>` and every row that returns "document"). These keys may not be renamed; extra keys are allowed:

```
{"id": "<uuid>", "title": "<text>", "status": "draft|in_progress|sealing|completed|declined|voided",
 "teamId": "<uuid>", "ownerId": "<uuid>", "timeZone": "<IANA zone>", "pageCount": <int>,
 "originalSha256": "<64 hex>", "completedSha256": null | "<64 hex>", "version": <int>,
 "currentOrder": null | <int>, "reminderAvailableAt": null | "<ISO 8601 UTC>",
 "recipients": [{"id": "<uuid>", "name": "<text>", "email": "<lowercase>", "order": <int from 1>,
   "status": "waiting|invited|viewed|signed|declined|expired", "delivery": null | "sent|held",
   "linkExpiresAt": null | "<ISO 8601 UTC>", "signedAt": null | "<ISO 8601 UTC>",
   "declineReason": null | "<text>", "binding": true | false}],
 "fields": [{"id": "<uuid>", "recipientId": "<uuid>", "kind": "signature|initials|date|text",
   "label": "<text>", "required": true | false, "page": <int>, "x": <0..1>, "y": <0..1>, "w": <0..1>, "h": <0..1>,
   "value": null | "<text>"}]}
```

- `value`: a text field holds its text. A date field holds `YYYY-MM-DD`. Signature and initials hold `typed:<the typed text>` or `drawn`.
- `version` increases by one on every saved change.
- `currentOrder` is the `order` of the recipient whose turn it is while `in_progress`, otherwise null.
- `reminderAvailableAt` is the moment the document's reminder cooldown ends, while the document is in progress and that cooldown is still running; otherwise it is null. It does not depend on the current recipient's status, so it can be set while their link is expired.
- `delivery` is null until the recipient's turn begins. It is `sent` once their latest invitation or new-link email was accepted by the mail server, and `held` while it waits for a retry.
- Recipients are listed in `order`, and fields in creation order.

**Audit JSON:** `GET /api/documents/<id>/audit` returns `{"events": [...]}` in `seq` order. Each event is `{"seq": <int from 1>, "type": "<type>", "actor": "<email or system>", "recipientId": null | "<uuid>", "at": "<ISO 8601 UTC with milliseconds, e.g. 2026-11-02T09:15:00.123Z>", "prevHash": "<64 hex>", "hash": "<64 hex>"}`. The chain rule is in Business rules.

**Template JSON:** `{"id": "<uuid>", "name": "<text>", "status": "draft|shared|retired", "pageCount": <int>, "signerCount": <int>, "fields": [{"signer": <int from 1>, "kind", "label", "required", "page", "x", "y", "w", "h"}]}`.

**Session**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/session` | `{"email", "password"}` | `200 {"user": {"id", "email", "name"}, "team": {"id", "name"}, "role": "owner|member|viewer"}` and sets an HTTP-only, SameSite=Lax session cookie | `401 {"error": "invalid_credentials"}` |
| `GET /api/session` | | `200` same body as above | |
| `DELETE /api/session` | | `204` | |

**Documents** (any team role may read; writes need the roles in Business rules)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/documents?filter=all\|in_progress\|completed\|closed` | | `200 {"documents": [{"id", "title", "status", "nextStep", "updatedAt"}]}`, newest `updatedAt` first, caller's team only. `closed` means declined or voided; `nextStep` is the Next step text | |
| `POST /api/documents` | multipart: `file` (required), `title` (optional, 1 to 120 characters; default is the file name without `.pdf`) | `201` document | `413 {"error": "too_large", "limit": 25000000}`, `415 {"error": "not_a_pdf"}`, `422 {"error": "pdf_encrypted"}`, `422 {"error": "pdf_has_scripts"}`, `422 {"error": "pdf_rotated"}`, `422 {"error": "too_many_pages", "limit": 60}`, `422 validation` (`file`, `title`), `503 storage_unavailable` |
| `GET /api/documents/<id>` | | `200` document | |
| `PATCH /api/documents/<id>` | `{"title"?, "timeZone"?}` | `200` document | `422 validation` (`title`, `timeZone`) |
| `GET /api/documents/<id>/original.pdf` | | `200` original bytes | `503 storage_unavailable` |
| `POST /api/documents/<id>/recipients` | `{"name", "email"}` | `201` recipient | `422 validation` (`name`, `email`, `recipients`) |
| `PATCH /api/documents/<id>/recipients/<recipientId>` | `{"name"?, "email"?}` | `200` recipient | `422 validation` |
| `DELETE /api/documents/<id>/recipients/<recipientId>` | | `204`; their fields are removed and later orders close up | |
| `POST /api/documents/<id>/recipients/<recipientId>/move` | `{"direction": "up\|down"}` | `200 {"recipients": [...]}` | `409 {"error": "cannot_move"}` at the top or bottom |
| `POST /api/documents/<id>/fields` | `{"recipientId", "kind", "page", "x", "y", "w", "h", "required"?, "label"?}` | `201` field | `422 validation` (`geometry`, `label`, `kind`) |
| `PATCH /api/documents/<id>/fields/<fieldId>` | any of `recipientId`, `page`, `x`, `y`, `w`, `h`, `required`, `label` | `200` field | `422 validation` |
| `DELETE /api/documents/<id>/fields/<fieldId>` | | `204` | |
| `POST /api/documents/<id>/send` | empty; optional header `Idempotency-Key` (1 to 100 characters) | `200` document | `422 {"error": "missing_signature_fields", "recipients": ["<name>", ...]}`, `422 {"error": "no_recipients"}`, `422 {"error": "idempotency_key_reused"}` |
| `POST /api/documents/<id>/remind` | empty | `200 {"reminderAvailableAt": "<ISO>"}` | `429 {"error": "reminder_cooldown", "availableAt": "<ISO>"}`, `503 mail_unavailable` |
| `POST /api/documents/<id>/recipients/<recipientId>/new-link` | empty | `200` document | |
| `POST /api/documents/<id>/void` | `{"reason"}` | `200` document | `422 validation` (`reason`) |
| `GET /api/documents/<id>/audit` | | `200` audit JSON | |
| `GET /api/documents/<id>/completed.pdf` | | `200` the stored completed bytes | `409` if not completed |
| `POST /api/documents/<id>/template` | empty | `201` template (`status` `draft`, `name` = title) | |

State refusals on these rows use `409 {"error": "invalid_state", "status": "<current document status>"}`. For recipient-level refusals (a new link for a recipient who is not expired, or a reminder when the current recipient is not `invited` or `viewed`), `status` is the recipient's status instead.

**Templates and team**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/templates` | | `200 {"templates": [...]}`. Owners see all of the team's templates; members and viewers see shared ones only | |
| `GET /api/templates/<id>` | | `200` template | `404` for members and viewers on a non-shared template |
| `POST /api/templates/<id>/share` / `.../retire` | empty | `200` template | `409 invalid_state` with the template status |
| `POST /api/templates/<id>/use` | `{"signers": [{"name", "email"}]}`, one per placeholder in order | `201` document (draft) | `409 invalid_state` unless shared, `422 validation` (`signers`) |
| `GET /api/team` | | `200 {"id", "name", "members": [{"id", "email", "name", "role"}]}` | |
| `PATCH /api/team/members/<userId>` | `{"role": "owner\|member\|viewer"}` | `200` member | `409 {"error": "last_owner"}` |

**Signing links** (no session; `<token>` is the link's secret)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/sign/<token>` | | `200 {"state": "your_turn\|signed_waiting\|sealing\|completed\|declined\|voided\|expired", "title", "recipient": {"id", "name", "order", "status"}, "signerCount", "current": null \| {"name", "order"}, "senderName", "declinedBy": null \| "<name>", "voidReason": null \| "<text>", "pageCount", "timeZone", "fields": [...], "otherFields": [{"page", "x", "y", "w", "h"}]}`. `fields` holds only this recipient's fields and is empty unless `your_turn` | unknown token: `404 {"error": "not_found"}` |
| `GET /api/sign/<token>/original.pdf` | | `200` original bytes | `409 link_closed`, `503 storage_unavailable` |
| `PUT /api/sign/<token>/fields/<fieldId>` | text: `{"value": "<text>"}` (empty clears); signature or initials: `{"typed": "<1 to 100 characters>"}` or `{"strokes": [[[x, y], ...], ...]}` with x, y as fractions of the pad (at most 5,000 points) | `200` field | `422 {"error": "read_only"}` for date fields, `422 validation` (`value`, `typed`, `strokes`) |
| `POST /api/sign/<token>/finish` | empty | `200 {"state": "signed_waiting\|sealing\|completed"}` | `422 {"error": "incomplete_fields", "remaining": <int>}` |
| `POST /api/sign/<token>/decline` | `{"reason"}` | `200 {"state": "declined"}` | `422 validation` (`reason`) |
| `GET /sign/<token>/completed.pdf` | | `200` the stored completed bytes | `409 link_closed` unless the document is completed |

Every write or PDF read through a link whose state is not `your_turn` answers `409 {"error": "link_closed", "state": "<state>"}`. An unknown field id, or another recipient's field id, answers 404.

**Grading** (needs header `X-Grading-Key` equal to env `GRADING_KEY`; a missing or wrong key, or an unset `GRADING_KEY`, answers `404 {"error": "not_found"}`; never returns link tokens)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/grading/setup` | `{"teams": [{"name", "members": [{"email", "name", "password", "role": "owner\|member\|viewer"}]}], "documents": [{"title", "team": "<team name in this call>", "owner": "<member email>", "sample": "letter-1\|letter-3\|a4-12", "timeZone": "<IANA>", "recipients": [{"name", "email"}], "fields": [{"recipient": <order>, "kind", "page", "x", "y", "w", "h", "required"}], "state": "draft\|in_progress\|completed\|declined\|voided", "signed": <int>}]}` | `201 {"teams": [{"name", "id"}], "users": [{"email", "id"}], "documents": [{"title", "id"}]}` | `409 {"error": "email_taken"}`, `422 validation` |
| `GET /api/grading/samples/<name>` | | `200` the sample PDF bytes | |

**Health:** `GET /api/health` answers `200 {"status": "ok"}` in every instance, including outage instances.

### Business rules (DP-07, DP-09, DP-10, DP-12, DP-13, DP-14, DP-15, DP-19, DP-26, DP-27, DP-28, DP-31, DP-33, DP-36, DP-38, DP-40, DP-42)

**Field geometry.**

- A field stores `page`, `x`, `y`, `w`, `h`. The last four are fractions of that page's width and height, from 0 to 1, origin at the page's top-left corner, rounded to 4 decimals.
- Every field lies fully inside its page: `x + w ≤ 1` and `y + h ≤ 1`. The minimum size is 0.02 by 0.02, and that size itself is allowed.
- The API refuses geometry that breaks these rules with the `geometry` validation key. The editor clamps instead of sending it.
- Default sizes on creation:

  | Kind | Width | Height |
  |---|---|---|
  | signature | 0.30 | 0.06 |
  | initials | 0.10 | 0.05 |
  | date | 0.20 | 0.04 |
  | text | 0.30 | 0.04 |

- A new field's label is `<Kind> <k>`, where `<Kind>` is `Signature`, `Initials`, `Date` or `Text` and `<k>` counts fields of that kind on the document (for example `Signature 2`). Labels are 1 to 40 characters. `required` defaults to true.
- The same stored fractions place each field in the editor, the signer view and the completed PDF. Measured against its `page-<n>` element's box, a rendered field's box, and the aperture when it frames that field, matches the stored fractions within **0.01** at 375, 768 and 1280 px widths and at every browser zoom level. Tests use this tolerance.
- PDFs with rotated pages are refused at upload.
- Fields, recipients, title and time zone can change only while the document is `draft`.
- Saved changes are visible in the document JSON within 2 seconds.

**Document states.**

| Transition | When | Who |
|---|---|---|
| `draft` → `in_progress` | send | the document's owner, or a team owner |
| `in_progress` → `sealing` | the last recipient signs | |
| `sealing` → `completed` | object storage confirms the completed PDF is stored | |
| `in_progress` → `declined` | the current recipient declines | |
| `in_progress` → `voided` | void, with a reason of 1 to 500 characters | the document's owner, or a team owner |

Every other transition is refused with `409 invalid_state`.

**Recipient states.**

| Transition | When |
|---|---|
| `waiting` → `invited` | their turn begins; the invitation is sent or held, and a new link is issued |
| `invited` → `viewed` | the first open of their link in `your_turn` |
| `invited` or `viewed` → `signed` or `declined` | they sign or decline |
| `invited` or `viewed` → `expired` | the link's lifetime passes |
| `expired` → `invited` | the sender issues a new link, with a new lifetime |

- Only the recipient whose `order` equals `currentOrder` may read the PDF, fill fields, sign or decline. The server checks this on every request.
- Waiting recipients have no link until their turn begins.
- When recipient k signs, recipient k+1's turn begins at that moment.

**Send rules.**

- There must be at least one recipient (`no_recipients`).
- Every recipient needs at least one required signature field. The refusal names every recipient who lacks one, in signing order (`order` ascending), both in the `recipients` array and in the on-screen copy.
- Each document has at most 10 recipients, and their emails are unique on the document, compared in lowercase.

**Decline and void.**

- Either one revokes every outstanding link at once and sets `binding` to false for every recipient. The completed PDF is never produced.
- A decline notifies the sender and every recipient who has already signed, but not the recipient who declined.
- A void notifies the sender, every recipient who has already signed and the recipient whose turn it was.
- Members may void only documents they own. Team owners may void any team document.

**Signing.**

- `finish` succeeds only when every required non-date field of the recipient has a value.
- At that moment, the recipient's date fields are filled with the server's date in the document's time zone, as `YYYY-MM-DD`. Signers can never edit date fields.
- Required text fields are complete when they hold at least one character other than spaces.
- A text field value is at most 200 characters: 200 is allowed, and 201 is refused.

**Links and time.**

- Each link is a fresh random secret of at least 128 bits. It belongs to one recipient on one document and is stored only as a hash.
- A link expires `LINK_TTL_SECONDS` after its recipient's turn began, at which point `linkExpiresAt` = turn start + that many seconds.
- The server checks expiry at least every 2 seconds and pushes the change to open pages.
- A new link replaces the old one. The old link's state from then on is `expired` while the document is in progress, and follows the document once it is closed.
- **Link state precedence** (the server decides it on every request):
  1. unknown token → not found;
  2. document voided → `voided`;
  3. declined → `declined`;
  4. completed → `completed`;
  5. sealing → `sealing`;
  6. recipient signed → `signed_waiting`;
  7. link replaced or expired → `expired`;
  8. otherwise → `your_turn`.

  A link that expired before completion still downloads the completed PDF.
- **Reminders:**
  - A reminder goes to the current recipient. It is allowed only while that recipient is `invited` or `viewed`, and at most once per document per `REMINDER_COOLDOWN_SECONDS`.
  - A reminder during the cooldown answers 429 with the server's `availableAt`.
  - A reminder while the current recipient is `expired` answers the recipient-level `409 invalid_state` (`status` `expired`) instead, even while the cooldown is running. During that time `button "Send reminder"` is absent and the expired row offers `Send a new link`.
  - A reminder that fails because email is down answers 503 and does not start the cooldown.
- The browser never decides turn, expiry or reminder availability from its own clock. The device clock may be wrong. Pages render only the state the server returns or pushes.

**Live updates.**

- The server pushes changes to open pages over a same-origin live channel (WebSocket or Server-Sent Events). Open pages show the change within 3 seconds, without reload.
- This includes changes made by another app instance that shares the same database.
- Pages never poll faster than the live channel delivers.

**Idempotency and races.**

- A send carrying an `Idempotency-Key` stores its response. A repeat with the same key on the same document returns that stored status and body, whatever has happened since. The same key on another document answers `422 idempotency_key_reused`.
- Of two simultaneous sends, exactly one succeeds. The other answers `409 invalid_state`.
- Of two simultaneous `finish` requests from one recipient, exactly one writes `recipient.signed`. The other answers `409 link_closed`.
- Of a void and a sign arriving together, whichever commits first wins, and the other answers 409.
- Of two simultaneous reminders, one succeeds and the other answers 429.

**Completion.**

- A document becomes `completed` only after every recipient has signed **and** object storage has confirmed the completed PDF is stored.
- Until then it shows `sealing`.
- The first storing attempt is made by the instance that recorded the last signature.
- If storing fails, the document stays `sealing`. No instance retries sooner than `SEAL_RETRY_SECONDS` after the last failed attempt; that is the earliest moment. A retrying instance makes its attempt no later than its own `SEAL_RETRY_SECONDS` plus 3 seconds after that earliest moment. Only one instance attempts at a time.
- Only an instance whose email and storage both pass its latest health check (Services) retries a seal. In the grading setup that is the main instance.
- So a document whose last signature lands on the storage-down instance stays `sealing`, with no completed email, for at least `SEAL_RETRY_SECONDS`. The main instance then seals it no later than its own `SEAL_RETRY_SECONDS` plus 3 seconds after that earliest moment, and it becomes `completed` at once. With the grading instances' default of 30 seconds, that is at least 30 and at most 63 seconds after the failed attempt.
- A document sealed by the email-down instance becomes `completed` normally. Its completed copies are held and delivered as described under Recovery in Services.
- Completed emails go out only after `completed`, once per distinct email address among the recipients and the sender. While email works, they reach the mail server within 3 seconds of `completed`.
- From the last signature to completion, the audit events are exactly these, in order:
  1. the last recipient's `recipient.signed`, written as the document enters `sealing`;
  2. `document.sealed`, written once, when object storage confirms the completed PDF is stored;
  3. `document.completed`.

  Failed storage attempts write no event. The certificate is drawn before `document.sealed` exists, so its chain head is the hash of that last `recipient.signed` event. Seeded `completed` documents write the same sequence.

**Completed PDF.**

- It is the original pages with every field's value drawn inside its box, followed by exactly one certificate page. Its page count is the original's plus 1.
- Typed values and dates are drawn as text, and drawn signatures as their strokes.
- It starts with `%PDF-`. Every page object is a plain object, not packed into a compressed object stream, so the pages can be counted by reading the file.
- All text in it is drawn in the standard Helvetica font (one of the 14 standard PDF fonts, not embedded), in plain ASCII. Any other character is written as `?`.
- The certificate page's content stream is uncompressed or Flate-compressed, and each of the following lines is drawn as one text string, in this order:
  - `Certificate of completion`
  - `Document: <title>`
  - `Document ID: <id>`
  - `Original SHA-256: <originalSha256>`
  - `Pages in original: <pageCount>`
  - one line per recipient: `Signer <order>: <name> <<email>> signed <YYYY-MM-DD HH:MM> UTC`
  - `Audit chain head: <hash of the last recipient's recipient.signed event>`
- `completedSha256` is the lowercase hex SHA-256 of the exact stored bytes. Both download routes return those same bytes.
- The certificate cannot carry the completed file's own hash, because the hash would change the file. That hash is published in the document JSON, the completed email and the document page instead.
- This is a tamper-evident record, not a certificate-based digital signature.

**Audit chain.**

- Every state change writes exactly one event. The complete list of types is: `document.created`, `document.sent`, `invite.sent`, `invite.held`, `recipient.viewed`, `recipient.signed`, `recipient.declined`, `document.voided`, `reminder.sent`, `link.resent`, `document.sealed`, `document.completed`.
- Expiry writes no event, because it is computed.
- A held invitation writes `invite.held`, and its later delivery writes `invite.sent`. A new link writes `link.resent`, plus `invite.held` if its email is held.
- `actor` is the acting user's email or the recipient's email, or `system` for `invite.*`, `document.sealed` and `document.completed`.
- `prevHash` of event 1 is 64 zeros. Each later `prevHash` is the previous event's `hash`.
- `hash` is the lowercase hex SHA-256 of the UTF-8 string `<prevHash>|<seq>|<type>|<recipientId or ->|<at>`, using `at` exactly as published.
- Events are never changed or deleted.

**Team scoping and roles.**

- Every list, search, read and download is filtered to the caller's team. Another team's document, template, recipient, field or audit id answers 404 and shows the not-found page, including ids inside request bodies such as `recipientId`.
- **Owners** change roles, save drafts as templates, share and retire templates, and void any team document.
- **Members** upload, edit and send their own drafts, void their own documents and use shared templates.
- **Viewers** read documents, audit trails and completed PDFs only. Their write calls answer 403, and the matching controls are absent.
- Editing another member's draft answers 403.
- A role change applies to the member's very next request and to their open pages within 3 seconds.
- The last owner cannot lose the owner role (`last_owner`).

**Templates.**

- States: `draft` → `shared` → `retired`, owner only. Other transitions answer `409 invalid_state`.
- Saving a draft as a template copies its original PDF and its fields at the same fractions. Recipients become placeholders `Signer 1`, `Signer 2`, … in order.
- Using a shared template creates a new draft with the template name as its title, a byte-identical original (same `originalSha256`), the same fields at the same fractions, assigned to the given signers in order.
- A retired template disappears from members' lists within 3 seconds.

### Services (DP-13, DP-14, DP-33, DP-35, DP-37, DP-38)

**PostgreSQL** holds teams, users, sessions, roles, documents, recipients, signing order, field geometry, link token hashes, stroke data, idempotency records, templates and the audit chain. The certificate page is drawn from these rows. Schema setup runs on every start and is safe when two instances start against the same database at once.

**MinIO** (bucket from `S3_BUCKET`) holds:

- the byte-identical original at `documents/<documentId>/original.pdf`;
- the completed PDF at `documents/<documentId>/completed.pdf`;
- template originals at `templates/<templateId>/original.pdf`.

A refused upload stores no object and no row. When storage is down:

- uploads answer 503 with the storage copy;
- pages that need the PDF show the storage copy from Feedback states;
- sealing waits and retries as in Business rules;
- the service notice shows.

**Mailpit**, over SMTP at `SMTP_HOST`:`SMTP_PORT`, receives every email.

- **From:**
  - Invitations, reminders and new-link emails use the display name `<sender name> via Undersign` with the address taken from `MAIL_FROM`.
  - Decline, void and completed emails use `MAIL_FROM` exactly.
  - Every grading instance sets `MAIL_FROM` to `Undersign <sign@wickmoor.example>`. When `MAIL_FROM` is unset, the app uses that same value. So with the grading setup, an invitation from Ada Byrne has the From line `Ada Byrne via Undersign <sign@wickmoor.example>`.
- **Headers:** in every header, each run of carriage returns and line feeds in a title or name becomes one space. Each message has exactly the intended `To` address and no other recipient headers.
- **Links:** every link is absolute, built from `APP_PUBLIC_URL`, and sits on its own line of the plain-text body.
- **Messages:**

| Email | To | Subject | Body lines |
|---|---|---|---|
| Invitation | the recipient, when their turn begins | `Please sign: <title>` | `Open the document: <APP_PUBLIC_URL>/sign/<token>` |
| Reminder | the current recipient | `Reminder: please sign <title>` | the same `Open the document:` line |
| New link | the expired recipient | `New link: <title>` | the same `Open the document:` line with the new token |
| Decline notice | as in Business rules | `Declined: <title>` | `Reason: <reason>` |
| Void notice | as in Business rules | `Voided: <title>` | `Reason: <reason>` |
| Completed copy | each party once | `Completed: <title>` | `SHA-256 of the completed PDF: <completedSha256>` and `Download: <link>` |

  The completed copy's link is `<APP_PUBLIC_URL>/sign/<token>/completed.pdf` for recipients and `<APP_PUBLIC_URL>/api/documents/<id>/completed.pdf` for a sender who is not a recipient.
- **When email is down:**
  - Invitations and new-link emails are held (`delivery` `held`, row word `Not delivered yet`, event `invite.held`).
  - Decline notices, void notices and completed copies that fail to send are also held and retried under the same Recovery rules. They write no audit event and do not change any recipient's `delivery`.
  - Reminders answer 503 and are never held.
- **Recovery:**
  - Only an instance whose email and storage both pass its latest health check retries held emails. An instance with either one down never retries held emails.
  - In the grading setup, the main instance therefore delivers every email held by the email-down instance. The storage-down instance never delivers held emails.
  - No instance retries a held email sooner than `MAIL_RETRY_SECONDS` after it was held, or after its last failed attempt. So a held email stays held, with its `Not delivered yet` row word and `Invitation not delivered yet to <name>` Next step, for at least that long. With the shared grading instances' default of 30 seconds, that is at least 30 seconds.
  - A retrying instance delivers it no later than its own `MAIL_RETRY_SECONDS` plus 3 seconds after that earliest moment.
  - The delivered link uses the delivering instance's `APP_PUBLIC_URL`. In the grading setup this is the main instance's.
  - When an invitation or new-link email is delivered, `delivery` becomes `sent`, the row reads `Invited` and `invite.sent` is written.
  - Each held email is delivered exactly once, even when several instances could retry it.
- **Email health:** the server checks email and storage at start and at least every 10 seconds, and immediately after any failed attempt. The service notice appears or clears on open pages within 3 seconds of the check. An instance's email or storage counts as working only while that instance's latest check of it succeeded. This status decides which instances retry held emails and seals.

### Seed data (DP-01, DP-32, DP-42)

The app starts with no teams, users or documents. All records come from `POST /api/grading/setup`. Every person, team and business a test creates is invented, for example `Ada Byrne` at `Fenwick Lane Studio`.

**Samples.** Three sample PDFs are built into the app, all invented content:

| Sample | Pages | Page size |
|---|---|---|
| `letter-1` | 1 | US Letter |
| `letter-3` | 3 | US Letter |
| `a4-12` | 12 | A4 |

Every page prints `Sample page <n> of <count>` in large type. The samples have upright pages, no scripts and no encryption.

**How setup builds each seeded document.** A seeded document behaves exactly as if it had happened through the app, and writes the same audit events at seeding time:

- Its original is stored in MinIO.
- `draft` documents have their recipients and fields.
- `in_progress` documents: the first `signed` recipients have signed with typed signatures of their own names (their required text fields hold their names, and their dates hold the seeding date). The recipient whose turn it is gets the normal invitation email with a fresh link lifetime.
- `completed` documents have every recipient signed this way, are sealed and stored, and send the completed emails.
- `declined` documents have the first `signed` recipients signed and the next one declined with the reason `Seeded decline`.
- `voided` documents have the first `signed` recipients signed and are voided by the owner with the reason `Seeded void`.

## Technical requirements

### Deployment (DP-47)

- **Runtime:** Node.js 22 LTS with npm. Server and browser code are TypeScript.
- **Manifest:** the app root holds `/app/run.json` with the string keys `install`, `build`, `serve` and `"_schema": "run-manifest-v1"`. For example:

  ```
  {"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "npm run start"}
  ```

- **Port:** the server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health:** `GET /api/health` answers HTTP 200 `{"status": "ok"}` once the server accepts requests.
- **Schema:** applied idempotently on every serve, not only at build.
- **Grading instances:** the main instance plus outage copies, each with its own `APP_PUBLIC_URL`:
  - one with object storage pointed at a dead address, sharing the main database and bucket name. It never retries held emails or seals.
  - one with email pointed at a dead address, sharing the main database and bucket name. It never retries held emails or seals, so the main instance delivers what it holds, as described under Recovery in Services.
  - one with short timers (`LINK_TTL_SECONDS` 8, `REMINDER_COOLDOWN_SECONDS` 4, `MAIL_RETRY_SECONDS` 2) and its own empty database and bucket.

### Configuration and secrets (DP-48)

The app reads all of these at start. None is hard-coded or sent to the browser.

| Group | Variables |
|---|---|
| Database | `DATABASE_URL` |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Public address | `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` |
| Grading | `GRADING_KEY` |

Timers, each a whole number of seconds:

| Variable | Default |
|---|---|
| `LINK_TTL_SECONDS` | 1209600 (14 days) |
| `REMINDER_COOLDOWN_SECONDS` | 86400 (24 hours) |
| `MAIL_RETRY_SECONDS` | 30 |
| `SEAL_RETRY_SECONDS` | 30 |

Variables whose names contain `OBSERVER` are not for the app.

### Server boundary (DP-43, DP-47)

- **Same origin only:** the server sends no cross-origin allowances. A state-changing request whose `Origin` header names another origin answers `403 {"error": "forbidden"}`.
- **Body limits:**
  - JSON bodies may be at most 1,000,000 bytes (that size allowed); above that, `413 {"error": "too_large", "limit": 1000000}`.
  - The upload's file part may be at most 25,000,000 bytes (that size allowed).
- **Upload checks.** Uploads are judged by their bytes, never by name or declared type, in this order:
  1. size;
  2. the bytes start with `%PDF-`;
  3. the trailer has no `/Encrypt`;
  4. the file contains no `/JavaScript` or `/JS` name;
  5. no page has a `/Rotate` other than 0;
  6. the page count is at most 60 (60 allowed).

  Nothing is stored, rendered or shown to a signer before every check passes.
- **Return after sign-in:**
  - A signed-out request for any app page redirects with 302 to `/sign-in?next=<the path and query, URL-encoded>`.
  - After sign-in, the app goes to `next` only when it is a same-origin path that starts with exactly one `/` (not `//` and not `/\`). Anything else, including absolute URLs, goes to `/documents`.
  - A signed-in visit to `/sign-in` goes straight to that destination.
- **What is served:** only built browser assets, the routes in this brief and the signer pages. Source files, `package.json`, environment files, source maps and credentials answer 404.
- **Self-contained assets:** fonts (Fraunces, Public Sans, IBM Plex Mono), icons, the PDF page renderer and its worker are all served by the app from open-licensed packages. The browser makes no request to any other origin.
- **Dependencies at boot:**
  - If object storage or email is unreachable, the app still starts, answers health, and shows the matching notice.
  - If the database is unreachable, the app keeps retrying for up to 60 seconds before exiting with a non-zero code.

### Browser support and performance (DP-45, DP-17)

- **Browsers:** current Chromium, Firefox and Safari. The verifier drives Chromium at 375x812 (touch), 768x1024 and 1280x800, sometimes with reduced motion.
- **Accessibility checks:** axe-core with the rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, counting violations at every impact level. The documents list, editor and signer view must have none at 375, 768 and 1280 px.
- **Load times:** the documents list is usable within 2 seconds of navigation. The first page of a 12-page document is visible within 3 seconds.
- **Field response:** a keyboard nudge moves the field on screen within one animation frame.
- **Browser clock:** the verifier pauses and advances the browser clock and may set it hours away from real time. On-screen state must still follow the server.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` keys and `"_schema": "run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root lists every shipped package with its version and licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is licensed MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC. Font packages may also be SIL OFL 1.1.
- IF-04: No datastore, queue or cache other than PostgreSQL, MinIO and Mailpit. The app keeps no state in local files or in-process stores that outlive a restart.
- IF-05: The provided service configuration (the dev compose service definitions and their credentials) is left unchanged.
- IF-06: All application source, server and browser, is TypeScript.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` on domain data and no type assertions that silence the compiler.
- Names match this brief's domain terms: document, recipient, signing order, field, link, seal, audit event, template, team, role.
- Each domain rule is decided in exactly one place in the source:
  - every document and recipient transition;
  - the link state precedence;
  - the Next step text;
  - field clamping;
  - the audit hash;
  - the role checks.
- Every error response uses the one error shape published in API.
- No abstraction has a single implementation, and there are no defensive checks for states the transitions make impossible.
- No dead, commented-out or unreachable code, and no features beyond this brief.
