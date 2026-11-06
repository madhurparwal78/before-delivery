# Quillmere Drafts

Quillmere Drafts is a live proposal editor for a one-person grant-writing consultancy and the people at its nonprofit clients who review its work. The consultant drafts foundation and federal grant proposals on a single paper-like page. They share each proposal person by person as Editor, Commenter or Viewer, and can give a share an end time. Everyone with access writes, suggests, comments and settles changes together in real time. The server records people, sessions, shares, suggestions, comments, decisions, notices, presence and the ordered history of edits in PostgreSQL. It stores each proposal's saved body as one object in MinIO-compatible object storage. Out of scope: sign-up, password reset, email of any kind, version history and restore, export and print, images and tables, offline editing, undo and redo, and any datastore other than PostgreSQL and the object store.

## Problem and users

Independent grant writers bill nonprofits by the hour, often for 20 hours a month or less per client. Today a proposal goes through a shared office document, email threads and chat. The program director rewrites the narrative, a finance officer checks the budget justification, and a board member or peer reviewer reads it once before the funder's portal deadline. This causes five problems. Versions drift apart. Reviewers keep access to past clients' drafts long after their review ends. Suggestions pile on top of each other until nobody knows whose wording won. One bulk "accept everything" click takes in text nobody read. General-purpose drives let any editor change or remove an expiry date. The consultant pays in unbilled reconciliation hours the night before a deadline. The client pays when a proposal goes out with an unreviewed budget line. In Quillmere Drafts the consultant owns every proposal. Outside reviewers see only what is shared with them. The server enforces every role on every action, access ends on the server at the moment the owner set, and every notice stays inside the app.

- **Consultant owner** (daily): drafts each proposal, shares it per person with Editor, Commenter or Viewer access and an optional end time, then settles every suggestion card before the deadline.
- **Client program director** (daily): rewrites narrative sections live next to the consultant as an Editor, then switches to Suggesting for changes the consultant must approve.
- **Outside reviewer** (occasional): as a Commenter, often with access until a set date and time, leaves suggestions and comments on one proposal and @mentions the consultant, and never sees any other client's work.
- **Finance officer** (weekly): as a Viewer, reads the budget justification, uses the outline and find to jump between sections, and follows the live edits.

## Journeys

1. **Set up a proposal.** The consultant starts signed out on the sign-in screen. They sign in, land on the documents home, search for an existing proposal, then open the New proposal dialog and create one for a client. In the Share proposal dialog they add the program director as Editor, the finance officer as Viewer and an outside reviewer as Commenter with an end time. The end state: the people list shows all three with their roles, emails and the reviewer's end time. Each grantee finds the proposal in Shared with me and gets a notice.
2. **Co-write live.** The consultant and the program director have the same proposal open in two browsers. Both type in the same paragraph, sometimes at the same spot. Each sees the other's caret with a name label, the other's text and the word count change in place. The save status goes from Saving to All changes saved. The end state: both screens show identical text, and a reload shows the same text. When storage is unreachable, the save status reads Not saved under a storage banner and never claims the edits are saved.
3. **Suggest and comment.** The program director switches the mode to Suggesting and rewrites a sentence. The outside reviewer, who is a Commenter, types inside that suggestion, selects a passage, and posts a comment that @mentions the consultant. They then run Replace all for a repeated phrase. The end state: every screen shows each change as a credited suggestion with its own margin card tethered to its words. The consultant has a mention notice.
4. **Settle the cards.** The consultant moves from card to card and accepts or rejects each one. Then they use Accept all after its confirmation names the count. At one moment the consultant and the program director decide the same card at once. The end state: each card leaves every margin, and only the first decision the server received applies. The other screen shows no error.
5. **Change a role mid-session.** The program director is typing as an Editor. The consultant changes them to Commenter in the Share proposal dialog. The end state: the program director's open editor switches to Suggesting without a reload, and their next keystroke appears as a suggestion credited to them.
6. **End a review.** The outside reviewer's access has an end time. At that moment on the server's clock, their open proposal closes with the access-ended screen, whatever their device clock says. Separately, the consultant removes another reviewer's share and later deletes an old proposal. The end state: the proposal is gone from those people's lists, search and notices, and any open tab of theirs shows the access-ended screen.
7. **Review from the keyboard.** The finance officer opens the budget justification as a Viewer. Using only the keyboard, they walk the outline and press Enter to jump to a heading, cycle through the margin cards with the card shortcut, read the mode switch, and use find to count matches. The end state: focus is back where each dialog was opened, and they never needed a pointer.
8. **Review on a phone.** The outside reviewer opens their proposal on a 375-pixel-wide phone. They open the folded toolbar, tap a numbered marker chip to open its card in the bottom sheet, and leave a suggestion and a comment. The end state: the page never scrolls sideways, and every card control is easy to tap.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in as a seeded person** Each seeded person signs in with their email and password on the sign-in screen and lands on their documents home, and a wrong pair shows the sign-in error from Feedback states.
- **DP-02 — Session API** The session endpoints sign a person in, report the current person and sign out using a session cookie, and every other route answers 401 without a valid session, in the error order stated under API.
- **DP-03 — Documents home lists** The consultant sees Recent and My proposals and everyone else sees Recent and Shared with me, and each list holds only proposals the person can open now.
- **DP-04 — Proposal search stays inside what you can open** The home search box and the documents list endpoint match titles and client names only among proposals the caller can open, and results update as the person types.
- **DP-05 — Create a proposal** Only the consultant creates proposals, through the New proposal dialog or the create endpoint, and becomes each one's sole Owner.
- **DP-06 — Share per person** The Owner shares a proposal with one existing person at a time as Editor, Commenter or Viewer with an optional end time, and the Share proposal dialog lists that person with their role.
- **DP-07 — Share rules** Creating, changing and removing shares follows the share rules in Business rules, with the exact statuses and field messages from API.
- **DP-08 — People projection by role** Share lists, comment and suggestion author chips, caret labels, presence chips and every API response give non-owners other people's display names, colours and roles only, while the Owner's share list also carries the email each share was granted to.
- **DP-09 — Unshared proposals look absent** A proposal the caller cannot open answers exactly like a proposal that does not exist, over HTTP, over the socket and on screen.
- **DP-10 — Co-write a proposal live** Two Editors typing in one proposal see each other's text, caret name labels and the word count change in place within one second, over one socket per page.
- **DP-11 — Server-ordered merge** The server orders concurrent edits, simultaneous inserts at one offset keep both texts in the order the server received them, and every open screen converges to identical text, marks and suggestion spans.
- **DP-12 — Live carets** Each other active person's caret shows on the page in their colour with their name label and follows their caret moves within one second.
- **DP-13 — Idle caret labels** A person with no input for the idle period loses their caret label on every other screen and gets it back on their next input.
- **DP-14 — Live word count** The word count shows the words of the proposal as it reads without open suggestions and updates within one second of any local or remote change.
- **DP-15 — Formatting and paragraph styles** In Editing mode, people with edit rights set bold, italic, underline, links and paragraph styles from the toolbar, toggle the marks with Ctrl+B, Ctrl+I and Ctrl+U, set Heading 1 to 3 with Ctrl+Alt+1 to 3, see the toolbar report the state at the selection, and the change reaches every open screen and the saved body.
- **DP-16 — Suggest changes** A person in Suggesting mode types, deletes and replaces text, selecting by character with Shift and the arrow keys or by word with Ctrl+Shift and the arrow keys, and every screen shows each change as a credited suggestion with its own margin card.
- **DP-17 — Credited suggestion spans** Suggesting-mode edits create, extend and withdraw suggestions exactly as stated in Business rules.
- **DP-18 — Edits inside another author's suggestion** Typing inside another author's suggestion creates a separate suggestion credited to the typist, and deleting text that holds a suggestion keeps both credits.
- **DP-19 — Commenters only suggest and comment** The server refuses a Commenter's direct edits, formatting, decisions, Accept all, Reject all and share changes, both over the socket and over HTTP, and the proposal stays unchanged.
- **DP-20 — Replace all while suggesting** Replace all in Suggesting mode creates one credited replacement suggestion per replaced match and never makes a direct edit.
- **DP-21 — Settle suggestion cards** An Editor or the Owner accepts or rejects each suggestion card with its buttons, or accepts it with Enter while the card itself has focus, the text changes on every screen, and the card leaves every margin within one second, while Enter in the page still starts a new paragraph.
- **DP-22 — First decision wins** When several Accept and Reject decisions arrive for one card at once, only the first one the server receives applies, and the rest are dropped without an error.
- **DP-23 — Accept all and Reject all** After a confirmation that names the count, Accept all or Reject all settles only the cards that are still open when the server processes it.
- **DP-24 — Decision announcements** Each of the person's own accepts, rejects, Accept all and Reject all is announced once in the Announcements region with the copy from Feedback states.
- **DP-25 — Comment on a passage** A Commenter, Editor or Owner selects text and posts a comment or a reply, and every screen shows the card in the margin within one second.
- **DP-26 — Anchors follow edits** Comment and suggestion anchors move with every edit made before them, and when all of an anchor's text is deleted the card reads Original content deleted and can still be settled.
- **DP-27 — Resolve and reopen** Comments move between open, resolved and reopened as stated in Business rules, and every screen updates in place within one second.
- **DP-28 — Mention picker scoped to the proposal** Typing @ in a comment offers only people with current access to that proposal, and the server refuses mentions of anyone else.
- **DP-29 — In-app notices** Mentions, new shares and role changes create in-app notices for the person concerned, which appear within one second and open the proposal.
- **DP-30 — Comment validation** The server validates comment bodies, anchors and mentions and answers with the field messages from API, and the comment form shows them beside the field.
- **DP-31 — Downgrade takes effect mid-session** When the Owner changes an Editor to Commenter, that person's open editor switches to Suggesting within one second without a reload, and their next keystroke becomes a credited suggestion.
- **DP-32 — Viewers only read** The server refuses every write frame and write call from a Viewer, while reading, finding, caret moves and presence still work.
- **DP-33 — Last mode remembered** The server stores each person's last mode on each proposal and restores it on reload, Back and a second tab, within what their role allows.
- **DP-34 — Timed reviewer access** A reviewer whose share has an end time sees when their access ends, works normally until then, and at that moment their open proposal closes with the access-ended screen.
- **DP-35 — Server decides when access ends** Access ends at the end time on the server's clock whatever the device clock says, the open tab closes within one second, and later calls and frames from that person are refused.
- **DP-36 — Ended shares stay visible to the Owner** Expired shares appear as Ended in the Owner's share list and can be granted again, while removed shares disappear from it.
- **DP-37 — Remove a reviewer** Removing a share closes that person's open tab with the access-ended screen within one second and drops the proposal from their lists.
- **DP-38 — Deleted proposals are gone** A deleted proposal answers not found by URL and API, its stored body object is removed, and it vanishes from every list, search, notice and open tab.
- **DP-39 — Lists and notices follow access live** Home lists, search results and notices drop a proposal within one second of the person losing access, and add it within one second of a new share.
- **DP-40 — Watch the save status** The save status moves from Saving to All changes saved after every change, and a reload shows the same proposal.
- **DP-41 — Saved only after storage confirms** All changes saved appears only after storage confirms the body object for that revision.
- **DP-42 — Storage outage** Once an edit is made while storage is unreachable, the save status reads Not saved under the storage banner, edits keep reaching other screens live, and the status does not show All changes saved again until storage confirms a later save.
- **DP-43 — Rebuild on reload, Back and second tab** A reload, Back or a second tab shows the same text, marks, suggestions, comments and mode as the screen that made them.
- **DP-44 — One announcement per save** The Save status region announces Saving and All changes saved once per save, with no repeats when cards re-render.
- **DP-45 — Review from the keyboard** A Viewer moves through the outline, the page, the margin cards, the mode switch and find with the keyboard alone.
- **DP-46 — Outline list** The outline lists every title and heading in page order, moves with the arrow keys and places the caret at a heading on Enter.
- **DP-47 — Card-cycle shortcut** The card-cycle shortcuts focus the next or previous margin card in page order from any control on the editor page.
- **DP-48 — Mode switch radiogroup** The mode switch is a radiogroup whose arrow keys move and select among the modes the person's role allows.
- **DP-49 — Find and replace dialog** The find and replace dialog keeps Tab inside it, closes on Escape, returns focus to its opener and announces the match count once per search.
- **DP-50 — Review on a phone** A Commenter on a 375-pixel-wide phone reads, suggests and comments through the folded toolbar, the bottom sheet and the numbered marker chips.
- **DP-51 — Published layouts** The editor shows three panes from 1200 pixels wide, a collapsible outline with the margin kept from 768 to 1199 pixels, and a single page column with a bottom sheet below 768 pixels, with no horizontal page overflow at any of the three published viewports.
- **DP-52 — Phone controls** Below 768 pixels the toolbar folds into one menu button, Enter or a tap on a marker chip opens its card in the bottom sheet, and margin card controls and mode radios are at least 44 pixels in both directions.
- **DP-53 — Margin tether alignment** Each margin card's top sits level with the first line of its anchored range within 2 pixels, crowded cards stack with 8 pixels between them, and a 1-pixel tether in the author's colour joins each card to its range.
- **DP-54 — Card focus and settle motion** A focused card moves 24 pixels toward the page with a thicker tether and a deeper highlight, and a settled card folds shut while the cards below glide up with their tethers attached, each movement finishing within 400 milliseconds.
- **DP-55 — Reduced motion keeps the tethers** Under reduced motion, cards jump to their final places and accepted text turns to ink at once, while tethers are still drawn and redrawn.
- **DP-56 — Paper on a desk** The editor reads as one warm off-white sheet with a faint warm shadow on a darker desk, with small-caps chrome and author colours on every card and caret.
- **DP-57 — Scholarly type and margin composition** Serif headings and body text at a book-like line length, with cards in a margin column beside their lines, give the page the look of an annotated manuscript.
- **DP-58 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check.
- **DP-59 — Credentials from the environment** Every service credential and URL is read from the environment at start and never appears in source or in anything sent to the browser.
- **DP-60 — Server boundary** The server accepts only same-origin traffic within the stated size and type limits, and never serves source files or credentials.

## Frontend

### Screens and layout (DP-01, DP-03, DP-09, DP-34, DP-37, DP-38, DP-50, DP-51, DP-52)

Routes: `/sign-in`, `/` (documents home) and `/d/<documentId>` (editor). A signed-out visit to `/` or `/d/<documentId>` goes to `/sign-in` and returns to the requested page after sign-in.

- **Sign-in screen.** A small centred card on the desk background with the brand name, Email and Password fields and a Sign in button.
- **Documents home.** A menu bar with the brand, the Notices button and Sign out. Below it are a heading, the search box and, for the consultant only, the New proposal button. The page shows two lists of proposal rows. The consultant sees Recent and My proposals. Everyone else sees Recent and Shared with me. Each row shows the title, the client name, the person's role and when it was last changed. In the consultant's My proposals list, each row also has a delete button. When the search box has text, a single Search results list replaces the two lists. On all three viewports this is a single centred column.
- **Editor.** From top to bottom:
  - A fixed menu bar with the Documents link, the title, the People here chips, the Share and Notices buttons and the mode switch.
  - A fixed toolbar.
  - The Document status bar, directly under the toolbar, with the save status, the word count and, for a share with an end time, "Access until <date and time>". `<date and time>` is the server's `accessEndsAt` shown in the device's local format. This label is display only.
  - The work area: the Outline rail, the page and the Margin.
  - So the vertical order at every viewport is: menu bar, toolbar (or the Toolbar button below 768 pixels), Document status bar, work area.
- **Layouts by width.** These widths are exact, and no other breakpoint may change which layout a published viewport gets.
  - **1200 pixels and wider** (published viewport 1280×800): three panes. The Outline rail is on the left, the page sits in the centre, and the Margin column is on the right.
  - **768 to 1199 pixels** (published viewport 768×1024): the Outline is collapsed behind the Outline button and opens as a panel over the left edge of the work area. The page and the Margin column sit side by side.
  - **Below 768 pixels** (published viewport 375×812): a single page column. The toolbar folds into one Toolbar menu button. The Outline opens from that menu as a dialog. The Margin becomes the Comments and suggestions bottom sheet, opened by a button in the status bar. Tethers are replaced by numbered marker chips placed in the text right after each anchored range. The mode switch stays in the menu bar.
  - At every viewport the page never scrolls sideways. Long words and URLs wrap inside the sheet.
- **Not-found screen.** It replaces the editor for any document id the caller cannot open. It shows a heading, one line of text and a link back to documents. The not-found copy is in Feedback states.
- **Access-ended screen.** It replaces an open editor when that person's access ends, their share is removed or the proposal is deleted. It uses the access-ended copy from Feedback states.
- **Storage-unavailable screen.** It replaces the editor when the proposal cannot be opened because storage is unreachable. The copy is in Feedback states.

### Public screens and controls (DP-01, DP-03, DP-04, DP-05, DP-06, DP-08, DP-12, DP-16, DP-21, DP-23, DP-25, DP-28, DP-29, DP-46, DP-47, DP-48, DP-49, DP-50, DP-52, DP-53)

Only these roles, names, copy and test hooks are public. Everything else is free. `<name>` is a person's display name, `<Role>` is one of Owner, Editor, Commenter or Viewer, `<title>` is a proposal title, and `<n>` is a whole number.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Sign-in | heading "Sign in to Quillmere Drafts" | |
| Sign-in | textbox "Email", password field labelled "Password", button "Sign in" | |
| Home and editor | button "Notices" | The accessible name is exactly "Notices". A badge shows the unread count when it is above 0 |
| Home and editor | dialog "Notices" containing list "Notices" | Each item is a link with the notice text from Business rules |
| Home | button "Sign out" | |
| Home | heading "Documents" | |
| Home | searchbox "Search proposals" | |
| Home | region "Recent", region "My proposals" (consultant), region "Shared with me" (others), each containing a list | Each row has a link whose accessible name is the proposal title |
| Home | list "Search results" | Replaces the regions while the search box has text |
| Home | button "New proposal" (consultant only) | |
| Home | dialog "New proposal" with textbox "Title", textbox "Client", button "Create", button "Cancel" | |
| Home | button "Delete <title>" (consultant only, per row) | |
| Home | alertdialog "Delete proposal" with button "Delete", button "Cancel" | Text: "Delete “<title>”? Everyone with access loses it at once." |
| Editor | link "Documents" | Goes to the home |
| Editor | textbox "Proposal title" (Owner) or heading level 1 (everyone else) | The proposal title |
| Editor | list "People here" | One item per person with the proposal open: their colour chip, `<name>` and `<Role>` |
| Editor | button "Share" | Opens dialog "Share proposal" for everyone |
| Editor | region "Document status" containing status "Save status" | The status bar also shows "<n> words" ("1 word") and the access label |
| Editor | toolbar "Formatting" | Buttons "Bold", "Italic" and "Underline" (toggle buttons that report pressed), button "Link", combobox "Paragraph style" (options "Title", "Heading 1", "Heading 2", "Heading 3", "Paragraph", "Bulleted item", "Numbered item"; it shows the style of the caret's paragraph), buttons "Comment", "Find and replace", "Accept all", "Reject all" |
| Editor | radiogroup "Mode" with radios "Editing", "Suggesting", "Viewing" | Radios the role does not allow are disabled |
| Editor | navigation "Outline" containing listbox "Headings" | One option per Title, Heading 1, Heading 2 and Heading 3 block, text = heading text |
| Editor, 768–1199 px | button "Outline" | Reports expanded or collapsed. Collapsed at start |
| Editor | textbox "Proposal body" (multi-line) | The page. Read-only in Viewing mode |
| Editor | complementary "Margin" | Holds the cards in page order |
| Editor | article "Suggestion by <name>" | Author chip (`<name>`, `<Role>`, colour). Its text is "Insert “<text>”", "Delete “<text>”" or "Replace “<old>” with “<new>”", or "Original content deleted". Buttons "Accept" and "Reject" appear for Editor and Owner |
| Editor | article "Comment by <name>" | Author chip, body, replies, textbox "Reply", button "Reply", button "Resolve" or "Reopen". The anchor text, or "Original content deleted" |
| Editor | checkbox "Show resolved" | In the Margin. Off at start |
| Editor | textbox "Comment", button "Post", button "Cancel" | The draft comment card |
| Editor | listbox "Mention people" | Options read "<name> · <Role>" |
| Editor | dialog "Share proposal" | For the Owner: textbox "Email", combobox "Access" (options "Editor", "Commenter", "Viewer"), checkbox "Set an end time", date-and-time field "Access ends", button "Add person". For everyone: list "People with access" and button "Close" |
| Share dialog | list "People with access" items | Each item shows `<name>` and `<Role>`. For the Owner it also shows the email, "Until <date and time>" or "Ended", combobox "Access for <name>" and button "Remove <name>". Non-owners see the line "Only the proposal owner can change access." |
| Editor | dialog "Find and replace" | Textbox "Find", textbox "Replace with", checkbox "Match case", buttons "Previous match", "Next match", "Replace", "Replace all", "Close". Visible count text |
| Editor | alertdialog "Accept all suggestions" / "Reject all suggestions" | Buttons "Accept all" or "Reject all", and "Cancel" |
| Editor | dialog "Link" | Textbox "Link address", buttons "Apply", "Remove link" and "Cancel" |
| All pages | status "Announcements" | Visually hidden, polite |
| All pages | alert | Banners from Feedback states |
| Editor, below 768 px | button "Toolbar" opening menu "Toolbar" | Menu items "Bold", "Italic", "Underline", "Link", "Paragraph style", "Comment", "Find and replace", "Accept all", "Reject all", "Outline", "Share" |
| Editor, below 768 px | button "Comments and suggestions" opening dialog "Comments and suggestions" | The button shows the open card count |
| Editor, below 768 px | button "Card <n>" | A numbered marker chip in the text. Its card in the sheet shows the same number |
| Not found | heading "Proposal not found", link "Back to documents" | |
| Access ended | heading "This proposal is no longer available", link "Back to documents" | |

Test hooks (attributes, public):
- Each margin card has `data-card-id="<suggestion or comment id>"`.
- Each highlighted span of an anchored range has `data-anchor-for="<id>"`.
- Each tether line is an SVG line or path with `data-tether-for="<id>"`.
- Each remote caret has `data-caret-for="<personId>"` and holds its name label as visible text.
- Each marker chip has `data-marker-for="<id>"`.

### Interactions (DP-10, DP-12, DP-15, DP-16, DP-25, DP-28, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-52)

- **Typing.** In Editing mode, keystrokes, paste (as plain text), Enter (new paragraph) and Backspace or Delete change the text at once on the typist's screen. Every other screen shows them within the live delay from Business rules. In Suggesting mode, the same keys produce suggestions: inserted text is underlined in the typist's colour, and deleted text stays in place, struck through in the typist's colour. Typing over a selection makes a replacement suggestion. In Viewing mode the page is read-only, and the caret still moves for reading and selection. Ctrl+Z and Ctrl+Y do nothing.
- **Formatting keys.** In Editing mode, Ctrl+B, Ctrl+I and Ctrl+U (Cmd on macOS) toggle bold, italic and underline on the selection: the mark is added when any selected character lacks it and removed when every selected character has it. Ctrl+Alt+1, Ctrl+Alt+2 and Ctrl+Alt+3 (Cmd+Option on macOS) set the caret's paragraph to Heading 1, Heading 2 or Heading 3, and Ctrl+Alt+0 sets it to Paragraph. Each change reaches the server as the same op as the matching toolbar control. In Suggesting and Viewing modes these keys change nothing.
- **Selection keys.** These hold in every mode, including over struck suggestion text. Shift+ArrowLeft and Shift+ArrowRight extend the selection by one character. A word is a run of letters or digits; spaces and punctuation are never part of a word, so "$9,600" holds the two words "9" and "600". Ctrl+Shift+ArrowRight (Option+Shift on macOS) extends the selection's moving end to the end of the word it is inside, or, when it is at a word end or outside a word, to the end of the next word. Ctrl+Shift+ArrowLeft extends it to the start of the word it is inside, or, when it is at a word start or outside a word, to the start of the previous word. Ctrl+ArrowLeft and Ctrl+ArrowRight move the caret by the same rule without selecting.
- **Formatting.** The Bold, Italic and Underline buttons and the Paragraph style combobox apply to the selection or to the caret's paragraph. Each mark button reports pressed while every character of the selection, or the character before the caret, carries its mark. The Link button opens dialog "Link" with focus in Link address. Apply sets a link mark with that address on the selection, Remove link removes the link mark from it, and Cancel or Escape closes the dialog without a change. Linked text is underlined in the spruce green. These controls are disabled in Suggesting and Viewing modes.
- **Mode switch.** The Mode radiogroup has a single Tab stop on the checked radio. The arrow keys (Left/Up and Right/Down) move to the previous or next allowed radio and select it, wrapping at the ends and skipping disabled radios. Selecting a radio changes the mode at once.
- **Comments.** The person selects text and presses the Comment button or Ctrl+Alt+M (Cmd+Option+M on macOS). A draft card opens beside the selection with focus in the Comment textbox. Typing @ opens the Mention people listbox, filtered by the letters typed after it. Up and Down move through the options, Enter or a click inserts "@<name>", and Escape closes the listbox. Post sends the comment. Cancel or Escape discards the draft and returns focus to the page selection. Reply and Resolve or Reopen act on their card. Show resolved toggles whether resolved comments appear in the Margin.
- **Cards.** Clicking a card, or a highlighted range, focuses its card. Alt+Shift+ArrowDown focuses the next card in page order and Alt+Shift+ArrowUp the previous one. Both work while focus is anywhere on the editor page (the page, the toolbar, the mode switch, the outline or a card's buttons) and wrap at the ends. When no card has focus, Alt+Shift+ArrowDown focuses the first card whose range starts at or after the caret, wrapping to the first card, and Alt+Shift+ArrowUp the last card whose range starts before the caret, wrapping to the last. These shortcuts put focus on the card element itself. Tab inside a focused card moves through its buttons. Enter while a suggestion card itself has focus accepts that suggestion, for the Owner and Editors, exactly as its Accept button does. Enter on one of a card's buttons activates that button. Enter in the page always starts a new paragraph and never decides a card. Escape on a card returns focus to the page with the caret at the start of that card's range.
- **Accept all and Reject all.** The button opens its alertdialog, which states the count. Its confirm button sends the decision. Cancel and Escape close it without a change. Focus starts on Cancel and returns to the opener.
- **Outline.** The Headings listbox has one Tab stop. Up and Down move the active option, Home and End jump to the first and last. Enter places the caret at the start of that heading, scrolls it into view and moves focus to the page. At 768–1199 pixels, the Outline button toggles the panel, and Escape closes it and returns focus to the button.
- **Find and replace.** The Find and replace button, or Ctrl+F (Cmd+F on macOS) while focus is on the editor page, opens the modal dialog with focus in Find. Matches are highlighted on the page as the person types, and the count updates. Enter and Next match go forward, Shift+Enter and Previous match go back, and the current match scrolls into view. Replace acts on the current match. Replace all acts on every match. Both follow the mode, and the replace controls are disabled in Viewing mode. Tab from the last control moves to the first control and Shift+Tab from the first moves to the last, so focus never leaves the dialog. Escape or Close closes it and returns focus to the opener: the button, or the page caret when it was opened with the shortcut.
- **Dialogs in general.** Every dialog, alertdialog, menu and sheet keeps Tab and Shift+Tab inside itself, closes on Escape and returns focus to its opener.
- **Share proposal dialog.** For the Owner: they type an email, pick Access, optionally tick Set an end time and pick a date and time in their local time zone, then press Add person. Changing a person's Access combobox applies at once. Remove <name> removes that person at once and moves focus to the next person in the list, or to Email.
- **Home.** Typing in Search proposals updates Search results as the person types, within the live delay. Clicking a notice opens its proposal and focuses the comment card it refers to, if any, and the notice becomes read.
- **Phone, below 768 pixels.**
  - The Toolbar button opens its menu. Arrow keys move through it and Enter activates an item.
  - Tapping or pressing Enter on a Card <n> chip opens the Comments and suggestions sheet with card n focused.
  - The sheet covers the lower part of the screen and can be dismissed by its Close button, by Escape, or by a downward swipe on its grab handle.
  - Touch selection plus the Comment menu item starts a comment.

### Visual design (DP-56, DP-57)

- **Ground and sheet.** The editor is a desk scene. The background is a warm light stone. The proposal sits on top as one warm off-white sheet with a faint, warm, one-pixel shadow, and it is the only bright surface on screen. Text is a warm near-black ink. Actions, links, the focus ring and the checked mode radio use a deep spruce green. Alerts and the storage banner use a brick red.
- **Author colours.** Each person has an author colour from the seed: deep spruce, plum, slate blue, ochre, rust, indigo or magenta. It appears on their avatar chip, caret, name label, suggestion text and tether. Every author colour, the ink and the green meet WCAG 2.2 AA contrast against the sheet, and chrome text meets it against the desk.
- **Type.** Headings are set in Newsreader, a bookish display serif. Body text is set in Source Serif 4. Each heading step is about one fifth larger than the step below it. Paragraphs run at about 68 characters per line with generous line spacing (about one and a half times the text size). Interface chrome (menu bar, toolbar, status bar, card meta lines) is set in small caps on the desk colour, so it reads as quiet labels around the sheet.
- **Composition and density.** The layout has comfortable density:
  - A centred sheet, a quiet heading rail on the left in muted ink, and cards on the right.
  - Cards are small paper slips in the margin column, each with a colour chip and the author's name at the top, aligned to the line it refers to.
  - Highlighted ranges have a pale wash of the author colour.
  - Icons are simple line icons.
- **Targets and focus.** Every control is at least 44 pixels in both directions on touch layouts, and at least 32 pixels on desktop layouts. Focus is always visible as a two-pixel spruce ring with a gap from the control.

### Motion and effects (DP-53, DP-54, DP-55)

- **Margin tether (the signature).** It shows which words each card belongs to and who made it.
  1. **Alignment.** Each card's top edge sits level, within 2 pixels, with the top of the first line of its anchored range. When cards would overlap, they stack with 8 pixels of space between them, and the following cards are pushed down. A tether 1 pixel thick, in the author's colour, runs from the card's left edge to the right end of the anchored range's last line.
  2. **Focus.** When a card is focused, by click or by the card-cycle shortcut, it slides 24 pixels toward the page in about a fifth of a second. Its tether thickens to 2 pixels, and its range wash deepens. If the range is out of view, the page scrolls so the card and the range are both visible. When focus leaves, these steps reverse at the same speed.
  3. **Settle on accept.** Inserted text turns from the author colour to ink over about a quarter of a second, or struck text collapses away over the same time. Then the card folds shut to nothing over about a third of a second. The cards below glide up to their new aligned places over the same third of a second, and each tether is redrawn on every frame of the glide so it stays attached. Rejecting runs the same fold and glide, with rejected inserted text collapsing away or the strike lifting.
  4. **Reflow.** When text above a card changes, whether by a local or a remote edit, the card and its tether move to the new line in the same frame as the text reflow, with no animation.
  5. **Deleted content.** When all of a range's text is deleted, its tether is removed and the card reads Original content deleted.
- **Other effects.** A new card fades in where it sits in about a fifth of a second. The bottom sheet slides up in about a third of a second and slides down when it closes. Buttons darken slightly on hover and press. Remote carets do not blink.
- **Feel and limits.** Every movement starts quickly and settles softly at the end. Each one finishes within 400 milliseconds. There are no decorative or looping animations.
- **Reduced motion.** When the person's system asks for reduced motion:
  - Cards jump straight to their final aligned places.
  - The focus offset is applied at once.
  - Accepted text switches to ink at once, and settled cards disappear at once.
  - The sheet appears without sliding.
  - Tethers are still drawn, and redrawn on every reflow, so the link between card and text is kept.
- **Below 768 pixels.** Tethers are replaced by the numbered marker chips at every motion setting.

### Feedback states (DP-01, DP-21, DP-24, DP-25, DP-30, DP-31, DP-34, DP-37, DP-38, DP-40, DP-42, DP-44, DP-49)

Every pending action disables its button and keeps the dialog open until the server answers. A field error from a 422 shows the API's field message under that field, and focus moves to the first field in error. Announcements go to the status region "Announcements" unless noted, and each is announced exactly once per event. Re-rendering cards or lists never repeats an announcement.

| Action | Pending | Success | Error and outage |
|---|---|---|---|
| Sign in | button reads "Signing in" | goes to the requested page or home | alert "That email and password don't match." on 401 |
| Create proposal | button reads "Creating" | goes to the new editor | field messages on 422 |
| Search proposals | none | the list updates as the person types. Announcement "<n> proposals" ("1 proposal"), or "No proposals match", made once, a third of a second after typing stops | |
| Add person | button reads "Adding" | announcement "Shared with <name> as <Role>" | field messages on 422; field message "This person already has access." on 409 under Email |
| Change access | none | announcement "<name> is now <Role>" | |
| Change end time | none | announcement "Updated access for <name>" | |
| Remove person | none | announcement "Removed <name>" | |
| Delete proposal | button reads "Deleting" | announcement "Deleted <title>" | alert "Quillmere can't reach storage, so the proposal wasn't deleted. Try again in a minute." on 503 |
| Accept or Reject one card | none | announcement "Suggestion accepted" or "Suggestion rejected" | if another decision won first, the card disappears with no announcement and no error |
| Accept all or Reject all | confirm button reads "Accepting" or "Rejecting" | announcement "<n> suggestions accepted" or "<n> suggestions rejected" ("1 suggestion …") | |
| Post comment or reply | button reads "Posting" | announcement "Comment posted" or "Reply posted" | field messages on 422 |
| Resolve or reopen | none | announcement "Comment resolved" or "Comment reopened" | on 409 the card shows its current state with no announcement |
| Find | none | visible count "<n> matches" ("1 match"), or "No matches". While stepping, "Match <i> of <n>". The count is announced once, a third of a second after typing stops | |
| Replace all | none | announcement "Replaced <n> matches" ("Replaced 1 match") in Editing mode, "Suggested <n> replacements" ("Suggested 1 replacement") in Suggesting mode | |
| Role changed for me | | announcement "Your access changed to <Role>.", followed by " You're now suggesting." or " You're now viewing." when the mode was switched | |
| Save status | status "Save status" reads "Saving" | then "All changes saved" | "Not saved" with the storage banner |
| Socket connection | | | alert banner "Connection lost. Reconnecting." The page is read-only until the socket rejoins. The banner leaves on rejoin |

- **Save status rules.** The status region text is the announcement. When the editor loads, the region's first text comes from the snapshot's `saveState`: "All changes saved" for `saved`, "Saving" for `saving`, and "Not saved" (with the storage banner) for `failed`. This first text is set as the page renders and is not an announcement; only later changes of the text count. After load, it reads "Saving" from the first change after the last confirmed save. It reads "All changes saved" only after the `saved` event for the latest revision, as defined in Business rules. It reads "Not saved" after a `save_failed` event. The region changes text once per save: continuous typing within one save batch does not re-announce Saving. When the status is Not saved, an alert banner shows "Your latest edits are not saved. Quillmere can't reach storage and is retrying." It disappears when a later save is confirmed.
- **Not-found screen.** Heading "Proposal not found", text "This proposal doesn't exist or isn't shared with you.", link "Back to documents".
- **Access-ended screen.** Heading "This proposal is no longer available". An alert gives the reason: "Your access ended at the time the owner set." (expired), "The owner removed your access." (removed) or "The owner deleted this proposal." (deleted). Link "Back to documents".
- **Storage-unavailable screen.** Heading "This proposal can't be opened right now", text "Storage is unreachable. Try again in a minute.", link "Back to documents".

## Backend

### API (DP-02, DP-04, DP-05, DP-07, DP-08, DP-09, DP-19, DP-22, DP-23, DP-28, DP-29, DP-30, DP-32)

**Conventions**
- Every request and response body is `application/json; charset=utf-8`. A request with a body of another type answers `415 {"error":"unsupported_media_type"}`.
- Request bodies and socket frames may be up to 65,536 bytes; 65,536 is allowed. Larger answers `413 {"error":"too_large"}`.
- Times are ISO 8601 UTC strings with seconds and a trailing `Z`.
- Ids are opaque strings. New ids hold at least 16 random URL-safe characters.
- Every error has one shape: `{"error":"<code>"}`. Validation errors also carry field messages: `422 {"error":"invalid","fields":{"<field>":"<message>"}}`.

**Error order.** It holds for every route and every socket frame: origin (HTTP only: a request whose `Origin` header does not match the host answers `403 {"error":"cross_origin"}`; an `Origin` matches when its host and port equal the request's `Host` header; an HTTP request without an `Origin` header passes this check), then body type and size (415, 413), then session (401 `{"error":"unauthenticated"}`), then whether the proposal and any nested record exist and the caller can open them (404 `{"error":"not_found"}`), then role (403 `{"error":"forbidden"}`), then state conflicts (409 with the code named below), then validation (422). A nested id that belongs to a different proposal counts as missing.

**People projection.**
- A person object is `{"personId","displayName","colour","role"}`. `colour` is the author colour as a `#rrggbb` string. `role` is `owner`, `editor`, `commenter` or `viewer` for the proposal in question, and is left out where no proposal applies.
- Responses never include another person's email, except one case: the Owner's view of share entries carries `email`.
- `GET /api/session` returns the caller's own email.
- Comment and suggestion authors, presence, caret frames, the people picker and non-owner share lists use the person object only.

**Endpoints**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/health` | | `200 {"status":"ok"}` | `503 {"status":"starting"}` until the database is reachable |
| POST `/api/session` | `{"email","password"}` | `200 {"person":{"personId","displayName","email","colour","isConsultant"}}` and sets an HttpOnly, SameSite=Lax session cookie valid for 12 hours | `401 {"error":"invalid_credentials"}`; 422 for a missing field (`"Enter your email."`, `"Enter your password."`) |
| GET `/api/session` | | `200 {"person":{…same…}}` | 401 |
| DELETE `/api/session` | | `204` and clears the cookie | |
| GET `/api/documents?view=recent\|mine\|shared&q=<text>` | | `200 {"documents":[{"id","title","client","role","updatedAt","owner":<person object>}]}` | 422 for an unknown `view` |
| POST `/api/documents` | `{"title","client"}` | `201 <document summary>` | 403 for anyone but the consultant; 422 `title`: "Enter a title of 1 to 120 characters.", `client`: "Enter a client name of 1 to 80 characters." |
| GET `/api/documents/<id>` | | `200` snapshot (below) | `503 {"error":"storage_unavailable"}` as stated in Services |
| PATCH `/api/documents/<id>` | `{"title"?, "client"?}` | `200 <document summary>` | 403 for non-owners; 422 as on create |
| DELETE `/api/documents/<id>` | | `204` | 403 for non-owners; `503 {"error":"storage_unavailable"}` |
| GET `/api/documents/<id>/shares` | | `200 {"shares":[…]}` | |
| POST `/api/documents/<id>/shares` | `{"email","role","endsAt"}` | `201 <share>` | 403 for non-owners; `409 {"error":"already_shared"}`; 422 (below) |
| PATCH `/api/documents/<id>/shares/<shareId>` | `{"role"?, "endsAt"?}` | `200 <share>` | 403 for non-owners; `409 {"error":"share_ended"}`; 422 |
| DELETE `/api/documents/<id>/shares/<shareId>` | | `204` | 403 for non-owners |
| GET `/api/documents/<id>/people?q=<text>` | | `200 {"people":[<person object>]}` | |
| POST `/api/documents/<id>/suggestions/<suggestionId>/decision` | `{"decision":"accept"\|"reject"}` | `200 {"suggestionId","status":"accepted"\|"rejected","applied":true\|false,"decidedBy":<person object>,"revision"}` | 403 for Commenter and Viewer; 422 `decision`: "Choose accept or reject." |
| POST `/api/documents/<id>/decisions` | `{"decision":"accept"\|"reject"}` | `200 {"decision","count","suggestionIds":[…],"revision"}` | 403 for Commenter and Viewer; 422 as above |
| POST `/api/documents/<id>/comments` | `{"anchor":{"at","length"},"body","mentions":[personId],"parentId"?}` | `201 <comment>` | 403 for Viewer; 422 (below) |
| POST `/api/documents/<id>/comments/<commentId>/resolve` | `{}` | `200 <comment>` | 403 for Viewer; `409 {"error":"not_open"}` |
| POST `/api/documents/<id>/comments/<commentId>/reopen` | `{}` | `200 <comment>` | 403 for Viewer; `409 {"error":"not_resolved"}` |
| GET `/api/notices` | | `200 {"unread","notices":[<notice>]}` | |
| POST `/api/notices/<noticeId>/read` | `{}` | `200 <notice>` | |

**Endpoint details**
- **Documents list.** With `view` left out, the list holds every proposal the caller can open. `recent` holds the up to 10 proposals the caller most recently joined, newest first. `mine` holds proposals the caller owns, and is empty for non-owners. `shared` holds proposals shared with the caller. `q` matches a case-insensitive substring of the title or client name within the chosen list. Other lists are sorted by `updatedAt`, newest first. A summary is `{"id","title","client","role","updatedAt","owner"}`.
- **Snapshot.** `{"id","title","client","revision","savedRevision","saveState":"saved"|"saving"|"failed","myAccess":{"role","mode","accessEndsAt"},"text","blocks":[{"style","at","length"}],"marks":[{"type":"bold"|"italic"|"underline"|"link","at","length","href"?}],"suggestions":[<suggestion>],"comments":[<comment>],"people":[<person object>]}`.
  - `text` is every character on the page, with blocks joined by `\n`. It includes open insertion and deletion text.
  - Offsets (`at`, `length`) count JavaScript string positions (UTF-16 code units) in `text`.
  - `accessEndsAt` is `null` without an end time.
  - `people` lists the Owner and every person with an active share.
- **Suggestion.** `{"id","kind":"insert"|"delete"|"replace","author":<person object>,"inserted":{"at","length"}|null,"deleted":{"at","length"}|null,"contentDeleted":bool,"status":"open"|"accepted"|"rejected","createdAt"}`. Snapshots list open suggestions only.
- **Comment.** `{"id","author","body","mentions":[<person object>],"anchor":{"at","length"}|null,"contentDeleted":bool,"status":"open"|"resolved"|"reopened","replies":[{"id","author","body","createdAt"}],"createdAt"}`. The 201 body for a reply (`parentId` set) is its parent comment object, with the new reply last in `replies`.
- **Share.** For the Owner: `{"shareId","person":<person object>,"email","role","endsAt","status":"active"|"expired"}`. The Owner's list holds active and expired shares and starts with the Owner's own entry, `{"person":<person object with role owner>}`. Everyone else gets `{"person":<person object>}` entries for the Owner and active shares only.
- **Share validation (422).**
  - `email`: "No Quillmere account uses this email." for an unknown address; "You already own this proposal." for the Owner's own address.
  - `role`: "Choose Editor, Commenter or Viewer."
  - `endsAt`: "Pick an end time in the future." when it is not later than the server's current time; "Pick an end time within a year." when it is more than 365 days after it. `null` means no end time.
- **Comment validation (422).**
  - `body`: "Write a comment of 1 to 2,000 characters." after trimming.
  - `anchor`: "Select the text this comment is about." when the length is below 1 or the range lies outside the text. A reply takes no anchor.
  - `mentions`: "Only people with access to this proposal can be mentioned."
  - `parentId` must name a top-level comment of the same proposal, otherwise 404.
- **Notice.** `{"id","kind":"mention"|"shared"|"role_changed","documentId","documentTitle","actor":<person object>,"role"?, "commentId"?, "text","read","createdAt"}`. The newest 50 are returned, newest first.

**Socket.** Each page opens exactly one WebSocket at `/api/socket` on the same origin.
- **Upgrade.** The origin check comes first: an upgrade whose `Origin` header is missing or does not match the host (as defined in the error order) answers HTTP 403. Otherwise an upgrade without a valid session cookie answers HTTP 401.
- **Before joining.** An unjoined socket receives `notice` and `lists_changed` frames. The editor page sends one `join`. Any other client frame before a join answers error `not_joined`. A second join on the same socket answers `conflict`.
- **Replies.** Every client frame carries a `ref` string. The server answers it with `{"type":"ack","ref",…}` or `{"type":"error","ref","code","fields"?}`, where `code` is `not_found`, `forbidden`, `conflict`, `invalid`, `too_large` or `not_joined`. A refused frame changes nothing and the socket stays open.

Client frames:

| Frame | Shape | Ack |
|---|---|---|
| join | `{"type":"join","ref","documentId","revision"}` | `{"type":"joined","ref","documentId","revision","role","mode","accessEndsAt","people":[<presence entry>]}`, followed by any `op` frames after the given revision |
| op | `{"type":"op","ref","baseRevision","mode":"editing"\|"suggesting","ops":[…]}` | `{"type":"ack","ref","revision"}` |
| mode | `{"type":"mode","ref","mode":"editing"\|"suggesting"\|"viewing"}` | `{"type":"ack","ref"}` |
| caret | `{"type":"caret","ref","at","length"}` | `{"type":"ack","ref"}` |
| heartbeat | `{"type":"heartbeat","ref"}`, sent every 15 seconds | `{"type":"ack","ref"}` |
| replace_all | `{"type":"replace_all","ref","baseRevision","mode","find","replace","matchCase"}` | `{"type":"ack","ref","revision","count"}` |
| decide | `{"type":"decide","ref","suggestionId","decision"}` | `{"type":"ack","ref","revision","applied","status"}` |
| decide_all | `{"type":"decide_all","ref","decision"}` | `{"type":"ack","ref","revision","count"}` |
| share | `{"type":"share","ref","shareId","role"?, "endsAt"?}` | `{"type":"ack","ref"}`. The same rules and errors as the share PATCH |

**Op frame details**
- Each entry in `ops` is one of:
  - `{"insert":"<text>","at"}`: 1 to 10,000 characters, with no control characters other than `\n`.
  - `{"delete":<length>,"at"}`: length at least 1, within the text.
  - `{"mark":"bold"|"italic"|"underline","value":true|false,"at","length"}`
  - `{"mark":"link","value":"<address>"|null,"at","length"}`: the address is an absolute `http` or `https` URL of up to 2,000 characters; `null` removes the link. Any other value answers `invalid`.
  - `{"style":"title"|"heading1"|"heading2"|"heading3"|"paragraph"|"bullet"|"numbered","at"}`: applies to the block containing `at`.
- Entries apply in order, each against the text left by the one before. In a `suggesting` frame a delete leaves its text in place (struck), so every later offset counts that struck text.
- A `baseRevision` above the current revision, an out-of-range offset, or a `mark` or `style` entry in a `suggesting` frame answers `invalid`.
- A proposal may hold up to 200,000 characters. A frame that would exceed that answers `too_large`.

Server frames to joined sockets:
- `{"type":"op","revision","authorId","mode","ops":[…]}`: to every other joined socket, as transformed by the server.
- `{"type":"card_added","card":<suggestion or comment>}`, `{"type":"card_changed","card":…}`, `{"type":"card_closed","cardId","status","decidedBy"}`. `decidedBy` is the person object of whoever decided, or of the author for a withdrawn insertion.
- `{"type":"caret","person":<person object>,"at","length"}`.
- `{"type":"presence","person":<person object>,"state":"active"|"idle"|"left"}`. A presence entry in `joined.people` is `{"person":<person object>,"state":"active"|"idle"}`, one for each other person with the proposal open.
- `{"type":"saved","revision"}`, `{"type":"save_failed","revision"}`.
- `{"type":"role_changed","role","mode"}`.
- `{"type":"title_changed","title","client"}`.
- `{"type":"access_ended","reason":"expired"|"removed"|"deleted"}`. The server then closes the socket.

Frames to every socket of a person, joined or not: `{"type":"notice","notice":<notice>}` and `{"type":"lists_changed"}`. The second tells the page to fetch its lists and notices again.

### Business rules (DP-03, DP-04, DP-06, DP-07, DP-09, DP-11, DP-13, DP-14, DP-17, DP-18, DP-19, DP-20, DP-22, DP-23, DP-26, DP-27, DP-28, DP-29, DP-31, DP-32, DP-33, DP-35, DP-36, DP-37, DP-38, DP-39, DP-41)

**Roles.** Every proposal has exactly one Owner: the consultant who created it. Only the consultant may create proposals. Every other person's access comes from one share with role Editor, Commenter or Viewer. The server checks the caller's current role on every HTTP call and every socket frame:

| Action | Viewer | Commenter | Editor | Owner |
|---|---|---|---|---|
| Open, read, caret, heartbeat, find, people picker, share list | yes | yes | yes | yes |
| Mode `viewing` | yes | yes | yes | yes |
| Mode `suggesting`, op frames in `suggesting`, replace_all in `suggesting` | no | yes | yes | yes |
| Comment, reply, resolve, reopen | no | yes | yes | yes |
| Mode `editing`, op frames in `editing` (including marks and styles), replace_all in `editing` | no | no | yes | yes |
| decide, decide_all, both decision routes | no | no | yes | yes |
| Rename, delete, create, change or remove shares (HTTP or share frame) | no | no | no | yes |

A "no" answers 403 over HTTP and error `forbidden` over the socket, and changes nothing. When an op frame is refused, the sender's screen goes back to the server's text.

**Visibility.**
- A person can open a proposal only while they are its Owner or hold an active share on it.
- For a proposal the caller cannot open, every HTTP route answers 404 `not_found`, a socket join answers error `not_found` with no other frame, and `/d/<id>` shows the not-found screen. All of these are identical to the responses for an id that never existed, and none of them carries the proposal's text, comments, people or presence.
- The documents list, search, the people picker, notices, the Recent list and presence only ever include proposals the caller can open now, and people who hold access to those proposals. No other client's title, client name or person reaches a caller.
- The people picker returns the Owner and people with active shares on that proposal, filtered by a case-insensitive substring of the display name.

**Shares.**
- States: `active` → `active` (role or end time changed) → `expired` (end time reached) or removed (deleted).
- POST for a person with an active share answers 409 `already_shared`. POST for a person whose share has expired creates a new active share, which replaces the expired entry.
- PATCH or a share frame on an expired share answers 409 `share_ended`. A removed share's id answers 404.
- A new share sends the grantee a `shared` notice. A role change sends a `role_changed` notice. An end-time change sends none.

**Role changes take effect at once.**
- A role change applies to the person's very next call or frame.
- Within one second the server sends their open sockets `role_changed`.
- A downgrade to Commenter from mode `editing` moves their stored mode to `suggesting`. A downgrade to Viewer moves it to `viewing`. An upgrade keeps the mode.
- The open editor switches the mode radio and disables the radios the new role does not allow, without a reload. Its next keystroke then produces a suggestion credited to that person.
- An op frame that was already in flight in `editing` mode after a downgrade is refused as above.

**Time rules.**
- **Server time decides access.** Access with an end time ends at that instant on the server's clock. From then on, every call and frame from that person for that proposal answers as for a proposal they cannot open. Within one second of the instant, the server marks the share `expired` and sends their open sockets `access_ended` with reason `expired`. The page shows the access-ended screen only when it receives that frame. It never decides from the device clock, which may be wrong.
- **Idle carets.** A person with no op, caret or mode frame for `PRESENCE_IDLE_SECONDS` seconds (default 60) becomes `idle`. Heartbeats do not count as input. Every other screen then hides their caret label within one second. Their next input makes them `active`, and the label returns within one second. A socket silent for 45 seconds counts as `left`.
- **Live delay.** Remote edits, caret moves, cards, comment resolutions, presence, word counts, list changes and notices appear on other screens within one second of the server accepting the change.

**Removal and deletion.**
- Removing a share, or deleting a proposal, ends access at once.
- The server sends `access_ended` with reason `removed` or `deleted` to the affected open sockets within one second. For a deletion that includes the Owner's other tabs.
- Within one second, every affected person's sockets get `lists_changed`. The proposal leaves their Recent, Shared with me, My proposals and search results, and their notices about that proposal are no longer returned.
- A deleted proposal answers 404 to everyone. Its records and its storage object are removed before the 204.

**Document model and merge.**
- A proposal is a sequence of blocks (Title, Heading 1, Heading 2, Heading 3, Paragraph, Bulleted item, Numbered item) with bold, italic, underline and link marks (a link mark carries its `href`), open suggestion spans and comment anchors.
- The server holds a single revision counter per proposal. Each accepted op frame, decision, Accept all, Reject all and replace_all adds exactly 1.
- The server transforms each op frame against every change made after its `baseRevision`, in the order it received them.
- When two inserts land at the same offset, the one the server received first ends up first, and both texts are kept.
- Overlapping deletes remove each character once.
- Carets, anchors and suggestion spans move with every change made before them.
- Every open screen converges to identical text, marks and suggestion spans.
- The word count is the number of runs of non-whitespace characters in the proposal as it reads without open suggestions: open insertion text is left out and open deletion text is kept.

**Modes.**
- Each person's mode per proposal is stored by the server. It is set by the `mode` frame, returned in the snapshot and `joined`, and restored on reload, Back and any new tab.
- The first open of a proposal starts in `editing` for Editors and the Owner, `suggesting` for Commenters and `viewing` for Viewers.
- A `mode` frame asking for a mode the role does not allow is refused per the roles table.

**Suggestions.**
- In `suggesting` mode an insert creates an insertion suggestion credited to the typist. A delete of plain text creates a deletion suggestion that keeps the text, struck. A delete entry immediately followed, in the same frame, by an insert entry whose `at` is the end of that struck text creates one replacement suggestion, with the inserted text placed right after the struck text. Typing over a selection sends exactly this pair. Any other combination creates separate suggestions.
- For example, if a block's text at offsets 100 to 111 reads `for the year`, the frame `{"type":"op","ref":"r1","baseRevision":7,"mode":"suggesting","ops":[{"delete":4,"at":108},{"insert":"term","at":112}]}` leaves `for the yearterm` in `text` and creates one `replace` suggestion with `deleted` `{"at":108,"length":4}` and `inserted` `{"at":112,"length":4}`. Its card reads Replace “year” with “term”.
- An insert that touches the start or end of the typist's own open insertion in the same block extends that suggestion instead of making a new card. A delete that touches the typist's own open deletion extends it.
- Deleting text inside the typist's own open insertion shrinks it. Deleting all of that text withdraws it: the record is closed as `rejected` by its author and the card leaves every screen.
- Typing inside another author's suggestion creates a separate insertion suggestion credited to the typist, and leaves the other suggestion's credit intact.
- In `suggesting` mode, deleting text that holds another author's insertion creates a deletion suggestion credited to the deleter over that text. Both cards stay.
- In `editing` mode, typed text never becomes part of a suggestion's credit.
- A direct edit that removes all of an open suggestion's text marks it `contentDeleted`. Its card reads Original content deleted, and accepting or rejecting it closes it without changing the text.
- **Replace all.** It acts on every case-insensitive match (case-sensitive with Match case) in `text` that does not overlap an open suggestion. In `suggesting` mode it creates one replacement suggestion per replaced match, credited to the sender, and never makes a direct edit. In `editing` mode it replaces directly. `count` is the number of matches replaced.
- Accepting an insertion keeps its text as plain text. Accepting a deletion removes the struck text. Rejecting does the opposite. A replacement does both halves together.

**Decisions.**
- A suggestion card is `open`, then `accepted` or `rejected`, and is decided exactly once.
- Decisions from both HTTP routes and both socket frames share one order per proposal. The first decision the server receives for an open card applies. Every later one for that card answers `200` with `applied: false` and the winning status (socket ack `applied: false`), changes nothing, and is never an error.
- Every screen removes the card within one second through `card_closed`.
- Accept all and Reject all apply to every card still open when the server processes them, `contentDeleted` cards included, and skip cards already decided. `count` is the number they decided.

**Comments.**
- States: `open` → `resolved` → `reopened` → `resolved`. The resolve and reopen pair may repeat any number of times.
- Resolve is allowed from `open` or `reopened`, otherwise 409 `not_open`. Reopen is allowed from `resolved` only, otherwise 409 `not_resolved`. When two people resolve at once, the first wins and the second answers 409.
- Anchors follow edits. When all of an anchor's text is deleted, `anchor` becomes `null` and `contentDeleted` becomes `true` for good. Such a comment can still be replied to, resolved and reopened.

**Mentions and notices.**
- Each mention creates a `mention` notice for the mentioned person, unless they are the author, with text "<actor> mentioned you in <title>".
- A `shared` notice reads "<actor> shared <title> with you as <Role>".
- A `role_changed` notice reads "Your access to <title> changed to <Role>".
- Notices reach the person's open sockets within one second. They are listed only while the person can open that proposal.

**Save state.**
- Each proposal has a `savedRevision`: the highest revision whose body object storage has confirmed, as stated in Services.
- The server sends `saved` with that revision only after storage confirms the write. It sends `save_failed` when a write fails.
- A screen shows All changes saved only when the latest `saved` revision equals the latest revision it knows of and it has no unacknowledged frames.
- `saveState` in the snapshot is `saved` when `savedRevision` equals `revision`, `failed` after a failed write that has not since succeeded, and otherwise `saving`.

### Services (DP-40, DP-41, DP-42, DP-43)

- **PostgreSQL** (`DATABASE_URL`) is the system of record. It holds people, sessions, shares with role, end time and status, the server-ordered operation history per revision, suggestion and comment records with their anchored ranges, decisions with who decided and when, stored modes, Recent entries, notices and presence. The app applies its schema and the seed data on every serve, idempotently, so an empty database comes up seeded and an existing one is never overwritten.
- **Object storage** (`S3_*`) holds one object per proposal at key `documents/<documentId>.json`, stored as `application/json`. Its body is `{"documentId","revision","text","blocks","marks","suggestions"}`. These have the same meanings as in the snapshot, and `suggestions` holds the open suggestions with `authorId` in place of `author`.
  - **Writes.** Within one second of any change to the body, the server writes the whole object for the latest revision. Changes made during a write are batched into the next one.
  - **Failures.** A write that fails or takes longer than 5 seconds counts as failed. The server sends `save_failed` and retries every 5 seconds until a write succeeds.
  - **Edits during an outage.** Edits are still recorded in PostgreSQL, still reach other screens live, and the save status follows the Save state rule.
- **Rebuilding a proposal.** A proposal's body is its latest stored object plus the operations recorded after that object's revision. A new proposal starts from an empty body at revision 0. Until storage first confirms an object for it, it is rebuilt from that empty body plus its recorded operations, so it opens and edits even while storage is unreachable. While anyone has a proposal open, the server keeps serving its live body. When nobody has it open, opening it reads its object. If that object is needed and storage is unreachable, the snapshot answers `503 {"error":"storage_unavailable"}` and the page shows the storage-unavailable screen.
- **Seed objects.** On serve, the app writes any missing seed object, and a seeded proposal's `savedRevision` becomes 1 once storage confirms it. When storage is unreachable at boot, the app keeps serving and retries that write every 5 seconds. Until the write succeeds, the seeded proposal has `savedRevision` 0, still appears in lists, and needs its object to open: GET `/api/documents/<seed id>` answers `503 {"error":"storage_unavailable"}` and `/d/<seed id>` shows the storage-unavailable screen. For example, when storage has been unreachable since boot, a proposal created during the outage opens with `saveState` `saved` and `savedRevision` 0 and edits normally, while every seeded proposal answers 503.
- **Deletion.** Deleting a proposal removes its object before answering 204. When storage is unreachable, it answers 503 and the proposal stays.

### Seed data (DP-01, DP-03, DP-06, DP-16, DP-25)

Every seeded person, organisation and proposal is invented. Every seeded person's password is `quillmere-demo-2026`.

| Display name | Email | Author colour | Notes |
|---|---|---|---|
| Ines Calloway | ines@quillmere.test | deep spruce | the consultant (`isConsultant: true`), Owner of every seeded proposal |
| Tomas Reyes | tomas@riverbend-literacy.test | plum | program director, Riverbend Literacy Project |
| Dana Whitfield | dana@riverbend-literacy.test | slate blue | finance officer, Riverbend Literacy Project |
| Priya Nandakumar | priya@peer-review.test | ochre | outside reviewer |
| Lena Ostrowski | lena@harborstreet-pantry.test | rust | program director, Harbor Street Food Pantry |
| Sam Adeyemi | sam@peer-review.test | indigo | outside peer reviewer |
| Jordan Pike | jordan@peer-review.test | magenta | holds no shares at start |

Proposals. Each starts at revision 1, which counts as saved once its seed object is written, as stated in Services. The shares have no end time.

1. `riverbend-reading-nights`: title "Family Reading Nights — Foundation Proposal", client "Riverbend Literacy Project". Shares: Tomas Reyes Editor, Dana Whitfield Viewer, Priya Nandakumar Commenter. Blocks in order:
   - Title "Family Reading Nights"
   - Heading 1 "Statement of Need"
   - Paragraph "In the Riverbend school district, 41 percent of third graders read below grade level. Families tell us they want to read with their children but rarely have books at home or a quiet evening space."
   - Heading 1 "Program Design"
   - Paragraph "Each month we host four Family Reading Nights at two branch libraries. Every family leaves with two new books and a short guide for reading aloud in English and Spanish."
   - Heading 1 "Evaluation Plan"
   - Paragraph "We will track attendance at every session and survey families in October and May."
   - Heading 1 "Budget Justification"
   - Paragraph "Books for 240 families cost $9,600 for the year. Facilitator stipends total $7,200."

   Each block's text above is its exact seeded text. The Program Design paragraph as printed already contains the open insertion, so the phrase appears once in `text`. Open suggestion `sg-seed-1` (kind `insert`) is Tomas Reyes's insertion of " in English and Spanish" (leading space included), the 23 characters just before that paragraph's final period, with `inserted` `{"at":397,"length":23}` and `deleted` `null`. Open comment `cm-seed-1` by Priya Nandakumar is anchored on "survey families in October and May" at `{"at":484,"length":34}`, with body "Could the survey also ask how many books each family already has at home?".
2. `riverbend-budget-fy27`: title "Budget Justification FY2027", client "Riverbend Literacy Project". Shares: Tomas Reyes Editor, Dana Whitfield Viewer. Blocks:
   - Title "Budget Justification FY2027"
   - Heading 1 "Personnel"
   - Paragraph "A part-time program coordinator at 20 hours a week costs $26,000 including benefits."
   - Heading 1 "Supplies"
   - Paragraph "Books and reading guides cost $9,600."
   - Heading 2 "Notes for the finance office"
   - Paragraph "Coordinator hours match the program calendar. Book costs match the vendor quote."
3. `harbor-cold-storage`: title "Cold Storage Expansion — Federal Application", client "Harbor Street Food Pantry". Shares: Lena Ostrowski Editor, Sam Adeyemi Commenter. Blocks:
   - Title "Cold Storage Expansion"
   - Heading 1 "Project Summary"
   - Paragraph "Harbor Street Food Pantry requests $148,000 to install a walk-in cooler and freezer so we can accept fresh produce donations year round."
   - Heading 1 "Budget Justification"
   - Paragraph "Equipment and installation total $121,500. Electrical upgrades total $26,500."
4. `harbor-volunteer-renewal`: title "Volunteer Program Renewal", client "Harbor Street Food Pantry". No shares. Blocks:
   - Title "Volunteer Program Renewal"
   - Paragraph "Draft outline to follow."

No notices, Recent entries or stored modes exist at start.

## Technical requirements

### Deployment (DP-58)

- The runtime is Node.js 22 with npm. Write the application in TypeScript.
- At `/app/run.json`, provide string commands `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or 4173 when it is unset.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the database is reachable, even when storage is not.
- Schema and seed are applied on every serve, never only at build.

### Configuration and secrets (DP-59)

- Read these at start: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `APP_PUBLIC_PORT` and `PRESENCE_IDLE_SECONDS`.
- `PRESENCE_IDLE_SECONDS` is a whole number from 1 to 3600, with default 60.
- The bucket named in `S3_BUCKET` is provided. Use it and create no other bucket.
- Never hard-code a credential, URL or bucket name. Never log credentials. Never send any of these values to the browser.

### Server boundary (DP-60)

- The server accepts same-origin traffic only. It sends no cross-origin headers and refuses cross-origin requests and socket upgrades as stated under API. The body-type and size limits are stated under API.
- It serves only the built browser assets, the self-hosted fonts and icons, and the API. A request for source files, source maps, `run.json`, package or lock files, environment files or any path outside the built assets answers 404.
- The browser loads nothing from another origin.
- Session cookies are HttpOnly and SameSite=Lax.
- When the database is unreachable at boot, the server starts listening, answers health with 503 `{"status":"starting"}`, and retries the connection every 2 seconds. When storage is unreachable at boot, it serves normally, as stated in Services.

### Browser support and performance (DP-10, DP-51)

- Support current Chromium, Firefox and WebKit at the published viewports 375×812, 768×1024 and 1280×800, with mouse, keyboard and touch input.
- With the seed data, the editor can be typed in within three seconds of navigation.
- A keystroke appears on the typist's screen within a tenth of a second. Remote changes follow the live delay in Business rules.

## Working rules

- IF-01: `/app/run.json` is valid JSON holding exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package, both fonts (Newsreader, Source Serif 4) and the icon set, each with its licence. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (as defined in IF-02) uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and fonts use OFL-1.1.
- IF-04: The app stores data only in the provided PostgreSQL database and the provided bucket. No other datastore, embedded database or on-disk state file is used.
- IF-05: Application source, server and browser alike, is TypeScript, with a committed lockfile.
- IF-06: The provided service configuration files are left unchanged.

## Engineering standards

- TypeScript runs in strict mode, and domain values (roles, modes, share states, suggestion kinds, save states) are typed unions, not loose strings or `any`.
- Names in the source match this brief's terms: proposal, share, Owner, Editor, Commenter, Viewer, mode, suggestion card, comment, anchor, revision, notice, presence, saved revision.
- Each domain rule is decided in exactly one place in the source: the role permission table, visibility, first decision wins, share expiry, idle presence, suggestion crediting and the save state.
- Every HTTP error and every socket error frame is built through the single error shape defined under API.
- There is no abstraction that has only one implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the types already rule out, and no features beyond this brief.
- Time decisions for access, expiry and idleness use the server's clock only, and the browser code renders server status without comparing to its own clock.
