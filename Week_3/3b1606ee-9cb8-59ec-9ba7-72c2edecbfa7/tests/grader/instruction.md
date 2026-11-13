# Halfpenny Post Co. Airfold

Airfold is a web messenger for one-to-one letters and attachments. You don't need a phone number or an email address to use it. A person picks a username, a display name and an optional photo. Their identity key is made in the browser and never leaves it. Every letter, photo, file, display name and filename is sealed before it leaves the page. The exchange (the Airfold server) holds sealed letters for an offline recipient until the recipient's browser collects them, records the delivery and then deletes its copy. Build it as one TypeScript web app: a Node server plus a browser client. It uses PostgreSQL for accounts, conversations, sealed letters and delivery state, and MinIO object storage for sealed attachments and profile photos. Live updates travel over a WebSocket served by the same server. Out of scope: passwords, email, phone numbers, group conversations, voice and video, link previews, QR codes, push notifications outside the open page, search beyond exact usernames, any AI feature, and any datastore or service other than PostgreSQL and MinIO.

## Problem and users

People who want a private one-to-one channel today have to give something up. The well-known encrypted messengers still tie every account to a phone number; a username only hides it. The tools that drop identifiers are installed apps with recovery phrases and onion routing, which a relative or a new friend won't put up with. None of them opens as a plain web page on a borrowed or locked-down phone. This hurts people who share a phone with family, people leaving a controlling partner, people who change SIM cards abroad, and anyone whose number is already in a breach dump. They fall back to messengers that expose their number, or to email, where the provider can read everything. Airfold asks for nothing but a username, seals everything in the browser, and holds letters only until they are collected.

- **Correspondent** (daily): finds a contact by exact username and writes sealed letters, photos and files to them. Watches each letter's postmark go from Sent (held at the exchange) to Delivered and Read.
- **Recipient on a new browser** (weekly): restores their account with the recovery code on a phone they have just picked up, and collects every letter the exchange held while they were away.
- **Cautious contact** (occasional): compares seal numbers with a correspondent in person, and is stopped by a warning when that correspondent's key changes.

## Journeys

1. **Sign up on a phone.** Start: a signed-out visitor on the landing page at 375 by 812. They choose Choose a username, type a username and watch the availability chip, then continue. They see their recovery code once, confirm they have written it down, and type back three of its groups. They set a display name and optionally a photo. End: the Chats screen with the empty-list copy, signed in.
2. **Find someone and write the first letter.** Start: a signed-in correspondent on Contacts. They type an exact username and press Enter. The result card shows only the username and a plain avatar. They choose Write a letter, type, and press Enter. End: the letter sits in the open conversation with a Sent postmark and the server's held time. In the recipient's browser a row appears under Letter requests.
3. **Accept a request.** Start: the recipient sees Letter requests (1). They open the request, read the letter (the sender's postmark stays Delivered) and choose Accept. End: the conversation moves to Chats for the recipient, and the sender sees the recipient's display name and photo appear without reloading.
4. **Write while the connection drops.** Start: two people in an accepted conversation. The sender goes offline, sees the Connecting bar, and writes five letters that stay Sending. The sender comes back online. End: the five letters arrive once each and in order in the other browser, and every postmark reads Delivered.
5. **Collect what was held.** Start: the recipient's browser is offline while the sender writes. The recipient reconnects and sees the Updating bar with the held count. End: the letters appear in order, the unread badges match the count, and the exchange holds nothing more for them.
6. **Send a photo or a file.** Start: an open conversation on a phone. The correspondent attaches a photo by touch. The letter reads as uploading until the sealed photo is stored, then posts. End: the recipient sees a blurred preview, then the photo. It opens in the photo viewer and closes with Escape. A file over the size cap is refused before any upload.
7. **Restore on a new browser and re-check the seal.** Start: two contacts who have verified each other's seal number. One of them restores the account in a new browser with the recovery code. Their old browser is signed out, and the letters held for them open in the new browser. End: the other person sees the key-change warning and can't send until they accept the new seal number, which differs from the old one.
8. **Tidy up.** Start: an open conversation. The correspondent deletes a letter for themselves and undoes it, deletes another for everyone, blocks a contact through a confirm dialog and later unblocks them, mutes a conversation, and changes their username in Settings. End: each change shows in both browsers as Business rules state.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Username rules** Usernames are 3 to 32 characters of lowercase letters, digits, underscores and dots, start with a letter, do not end with a dot, compare case-insensitively, are unique, and the availability check answers with the reasons in Business rules.
- **DP-02 — Sealed sign-up** Signing up takes only a username, a public identity key, a recovery verifier and a sealed key backup, sets a session cookie, and stores no plaintext private key, recovery code, display name or photo.
- **DP-03 — Sign-up journey** On a 375 by 812 phone, a new person picks a username with the live availability chip, writes down and checks their recovery code, sets a display name and optional photo, and lands on the empty letters list, all by keyboard.
- **DP-04 — Exact username lookup** Lookup matches the whole username case-insensitively, never by prefix, never returns the caller or a held name, and shows a non-contact only their username and a plain avatar.
- **DP-05 — Lookup journey** From Contacts, a correspondent types a username, presses Enter, hears the result announced and lands focused on the result card or the not-found message, then opens a conversation from the card.
- **DP-06 — Letter requests** A first letter from someone the recipient has not accepted lands in Letter requests, where opening sends no read receipt and shows no profile, and Accept, Delete and Block behave as Business rules state.
- **DP-07 — Request journey** In two browsers, a request row and count appear live for the recipient, Accept by keyboard moves the conversation to Chats, and the sender then sees the recipient's display name and photo without reloading.
- **DP-08 — Published sealing scheme** Every letter body, profile and attachment is sealed in the browser with exactly the published scheme, so a letter sealed by another implementation of the scheme opens in Airfold and an Airfold letter opens with the scheme.
- **DP-09 — One letter per letter id** Repeating a send with the same client letter id returns the original letter instead of creating a second one, and reusing an id for different content is refused with 409.
- **DP-10 — Delivery states** A posted letter is sent while held, becomes delivered when the recipient's browser collects it (server time, set once, held copy deleted), then read, or failed when returned after 30 days, and no other transition happens.
- **DP-11 — Reciprocal read receipts** A letter becomes read only if both people have read receipts on and the conversation is accepted when the recipient opens it, so turning receipts off stops both sending and seeing read.
- **DP-12 — Live letters journey** In two browsers, Enter sends a letter, focus stays in the composer, the sender's postmark goes Sending, Sent, Delivered, Read live, the recipient hears the new letter announced, and both lists show the last letter and its state after reload.
- **DP-13 — Outbox and retries** Letters written while offline wait in a persistent outbox on the Sending postmark, retry on the published backoff and immediately on reconnect, and post in the order written.
- **DP-14 — Offline sending journey** A sender who goes offline sees the Connecting bar after the published delay, writes five letters that stay Sending, and on reconnect the five arrive once each, in order, in the other browser while the bar leaves.
- **DP-15 — Held queue in order** The exchange holds letters for an offline recipient in posting order, hands them over in that order on collection, deletes each held copy once delivered, and returns uncollected letters after 30 days.
- **DP-16 — Unread counts** Each conversation's unread count, the Chats tab badge and the tab title equal the number of delivered, unopened, not deleted letters the server holds for the viewer, before and after reload.
- **DP-17 — Collecting journey** A recipient whose browser was offline reconnects, sees the Updating bar with the held count, receives the letters in order with matching badges, and leaves the exchange holding nothing for them.
- **DP-18 — Photo preparation** A photo is re-encoded in the browser without any location or camera metadata, no longer than 2048 pixels on its long edge, with a tiny blurred preview sealed inside the letter.
- **DP-19 — Stored before posted** A photo or file letter is posted only after the exchange confirms its sealed attachment is stored at the declared size; until then the letter reads as uploading, and a failed upload leaves no letter.
- **DP-20 — Participants only** Only the two participants can read a conversation, its letters and its attachments, and anyone else gets the same 404 as for something that never existed, including for ids inside request bodies.
- **DP-21 — Photo letters journey** On a phone, a correspondent attaches a photo by touch, the recipient sees the blurred preview then the photo with its published alt text, and the photo viewer opens by keyboard and closes with Escape back to the photo.
- **DP-22 — Attachment limits** Attachments are accepted only as declared photos, files or profile photos up to the published size cap, are refused over the cap before anything is stored, and are always served as a download, never shown inline.
- **DP-23 — Attachment check** The recipient's browser checks each downloaded attachment against the digest sealed in its letter and, on a mismatch, discards it and shows the corrupted notice with no download.
- **DP-24 — Storage outage** When object storage is unreachable, uploads and downloads fail with 503 and the published banner, health reports unavailable, and text letters keep flowing.
- **DP-25 — File letters journey** A correspondent is stopped before any upload when a file is over the cap, sends a file within it that the recipient downloads intact, and on the storage-outage instance sees the upload fail with Retry upload.
- **DP-26 — Deleting letters** Delete for me removes a letter from this browser after the Undo window, and Delete for everyone, allowed for your own letter within 24 hours of posting, replaces it with the published notice for both people.
- **DP-27 — Deletion journey** Letter actions open by keyboard and by long-press, Undo by keyboard restores a letter, Delete for everyone changes the other browser live, and after the server clock passes 24 hours the option is gone.
- **DP-28 — Blocking** Blocking someone drops every letter they post while blocked, so they see Sent and never Delivered, the blocker never receives those letters even after unblocking, and new letters flow again after unblocking.
- **DP-29 — Block journey** A correspondent blocks a contact through a confirm dialog that keeps focus inside and cancels with Escape, sees the Blocked contacts list, and unblocks, with each effect visible in both browsers.
- **DP-30 — Seal numbers** Both people see the same 60-digit seal number in 12 groups of 5 derived as published, and can mark the contact verified, which shows a Verified mark.
- **DP-31 — Recovery in a new browser** Entering the username and recovery code in another browser restores the account with a new identity key, signs out every other browser, and still opens every letter held before the restore.
- **DP-32 — Key change pauses letters** When a contact's identity key changes, their correspondents see the key-change warning and cannot post to them until they accept the new seal number, which the server enforces with 409.
- **DP-33 — Seal number journey** Two people compare and verify seal numbers, one restores in a new browser, and the other sees the key-change warning, letters paused until Accept new seal number, and then a different seal number.
- **DP-34 — Username changes** A username can change once every 7 days, and a released name is not found and cannot be claimed by anyone for 14 days, both measured by the server clock.
- **DP-35 — Username change journey** A correspondent changes their username in Settings with the availability chip, gets the published cooldown message on a second try, and succeeds after the server clock passes seven days.
- **DP-36 — Toasts, preview and mute** A letter arriving in a conversation that is not open raises a polite toast worded by the preview setting, except in a muted conversation, whose unread badge still counts.
- **DP-37 — Notifications journey** In two browsers, toasts follow each preview setting word for word without taking focus, badges count on the row and the Chats tab, and a muted conversation raises no toast.
- **DP-38 — Run manifest and health** The app installs, builds and serves from /app/run.json on port 4173 (or APP_PUBLIC_PORT) and answers GET /api/health with the published body.
- **DP-39 — Server boundary** The server accepts same-origin requests only, enforces the published body limits, serves no source files or credentials, and starts even when object storage is unreachable.
- **DP-40 — Published layouts** At 375 by 812 the app shows one pane at a time with a bottom tab bar, at 768 by 1024 the list and the open conversation sit side by side, and from 1200 pixels wide a contact card column joins them, with no sideways scrolling.
- **DP-41 — Keyboard and focus** Every action works by keyboard with a visible focus mark, dialogs keep Tab and Shift+Tab inside, Escape closes them and returns focus to their opener, and focus returns to the composer after each send.
- **DP-42 — Fold and postmark** Sending folds the letter in thirds, closes the flap, shrinks it into its row and strikes the postmark, and each later state change re-strikes the postmark, with the published timings and no motion after reload.
- **DP-43 — Reduced motion and touch** With reduced motion every fold, shrink and strike becomes a fade of at most 120 milliseconds or an instant change and nothing loops, and every control is at least 44 pixels for touch.
- **DP-44 — Aerogramme look** Every screen is a white aerogramme sheet with the airmail stripe edge on a hot orange field, set in Zilla Slab, with the landing hero, folded-letter rows, postmarks, form wells and tear-off error slips described in Visual design.
- **DP-45 — Honest sealing in source** The source seals and opens everything in the browser with the built-in Web Crypto interface, keeps the private key non-extractable in the browser's own store, and reads every credential from the environment.

## Frontend

### Screens and layout (DP-03, DP-05, DP-07, DP-12, DP-40)

Page routes:

- `/` is the landing page when signed out. When signed in it goes straight to `/letters`.
- `/signup` is the four-step sign-up.
- `/signin` restores an account with the recovery code.
- `/letters` is Chats, the conversation list.
- `/letters/:conversationId` is the open conversation.
- `/requests` is Letter requests.
- `/contacts` holds the contact list and the username lookup.
- `/settings` holds the profile, username, read receipts, notification preview and Blocked contacts.

Opening `/letters/:conversationId` for a conversation you are not part of, or one that doesn't exist, shows the not-found copy from Feedback states inside an empty sheet.

**Landing.** The orange field fills the window, and the hero sheet (Visual design) sits on it. Below the hero are two short sections, "How sealing works" and "Seal numbers", which the top links scroll to. The page ends in the back-flap footer.

**Sign-up.** One step at a time, on a printed form panel:

1. Username, with the availability chip under the field.
2. The recovery code, shown once.
3. The recovery check: three group fields.
4. Profile: display name and an optional photo.

**Chats.** A stack of folded-letter rows, newest activity first. Each row shows:

- the contact's photo, or a plain avatar;
- their name;
- the first line of the last letter, opened on this device;
- that letter's postmark and time;
- the unread disc.

Above the stack, a Letter requests link appears only while there is at least one request. **Letter requests** has the same stack style. An open request shows its letters with Accept, Delete and Block in place of the composer.

**Open conversation.** A white sheet with:

- a header showing the contact's name and seal status;
- the letters running down the sheet as paragraphs, oldest first, each with a small postmark;
- the composer in the sheet's blank lower third, under a dotted fold line.

The key-change warning stub, when present, sits between the letters and the composer.

**Contact card.** Shows:

- the photo;
- display name and username;
- seal status (Verified, Not verified or Seal number changed);
- Show seal number, Mute or Unmute, and Block or Unblock.

**Contacts.** The lookup form on top, then the accepted contacts as rows. **Settings.** Printed form panels for the profile, the username change, the Read receipts switch, the Notification preview choice and the Blocked contacts list.

Viewports (the switch points are exact):

- **Narrower than 768 pixels (published check: 375 by 812):** one pane at a time. Chats, Contacts and Settings are full-width. Opening a conversation replaces the list with the sheet and a Back to letters button. A bottom tab bar holds Chats, Contacts and Settings. The contact card opens as a dialog from the Contact card button.
- **768 to 1199 pixels (published check: 768 by 1024):** the list column (about two fifths of the width) on the left and the open conversation on the right, side by side. The tab bar sits across the top of the list column. The contact card is still a dialog.
- **1200 pixels and wider (published check: 1280 by 800):** three columns. List, open conversation, and the contact card as a standing column on the right. The Contact card button is not shown.

At every width, nothing scrolls sideways and every control stays inside the window.

### Public screens and controls (DP-03, DP-05, DP-07, DP-12, DP-21, DP-25, DP-27, DP-29, DP-33, DP-35, DP-37)

Only the roles, names and hooks below are public. Everything else is free. `<name>` is the contact's display name when it is known on this device, otherwise their username. `<n>` is a whole number.

| Where | Role and accessible name | Visible copy and hooks |
|---|---|---|
| Landing | heading level 1 `Letters that seal themselves` | set on two staggered lines: `Letters that seal` / `themselves` |
| Landing | link `How sealing works`, link `Seal numbers`, link `Sign in` | Sign in goes to `/signin` |
| Landing | link `Choose a username` | goes to `/signup`; looks like a solid ink button |
| Landing | the three hero lines | `No phone number`, `No email`, `Sealed in your browser` |
| Landing | the hero postmark | `Halfpenny Post · held until you're back` |
| Sign-up | textbox `Username`, button `Continue` | step 1 |
| Sign-up and Settings | `status` `Username availability` | the availability chip |
| Sign-up | group `Your recovery code` | holds `data-testid="recovery-code"`, whose text is the code exactly as Business rules format it |
| Sign-up | button `I've written it down` | step 2 |
| Sign-up | textboxes `Group <n>` (three of them), button `Check` | step 3; `<n>` is the position 1 to 8 being asked for |
| Sign-up and Settings | textbox `Display name` | |
| Sign-up | button `Add a photo` (opens a file input labelled `Photo`), button `Finish` | step 4 |
| Sign-in | textbox `Username`, textbox `Recovery code`, button `Restore account` | |
| App shell | navigation `Main` with links `Chats`, `Contacts`, `Settings` | the Chats link carries `data-testid="tab-unread-badge"` when the count is above zero |
| App shell | `status` `Letter updates` | polite; delivery, upload, new-letter and undo announcements |
| App shell | `status` `Notifications` | polite; holds toasts, each `data-testid="toast"` |
| App shell | `status` `Connection` | holds the Connecting and Updating bars (`data-testid="connecting-bar"`, `data-testid="updating-bar"`) |
| App shell | `alert` holding `data-testid="outage-banner"` | storage outage banner |
| Chats | list `Conversations` | each item holds a link, `data-testid="conversation-row"` with `data-conversation-id`, whose accessible name starts with `<name>`; the unread disc is `data-testid="unread-badge"` and shows the count, or `99+` above 99; the muted mark reads `Muted` |
| Chats | link `Letter requests (<n>)` | only when `<n>` is at least 1 |
| Every list | `data-testid="empty-state"` | the empty copy from Feedback states |
| Requests | list `Letter requests` | items `data-testid="request-row"` with `data-conversation-id` |
| Open request | region `Letter request` with buttons `Accept`, `Delete`, `Block` | |
| Conversation | heading level 2 `<name>`, button `Back to letters` (under 768 px), button `Contact card` (under 1200 px) | |
| Conversation | list `Letters` | each letter is an `article`, `data-testid="letter"`, with `data-letter-id`, `data-direction="sent"` or `"received"` and `data-delivery` set to exactly one of `sending`, `sent`, `delivered`, `read`, `failed` |
| Each letter | `data-testid="postmark"` | holds `data-testid="postmark-label"` (the label from Feedback states) and a `time` element whose `datetime` is the server timestamp |
| Each letter | button `Letter actions` | |
| Photo letter | button `Open photo` holding an image with alt `Photo from <name>` (received) or `Your photo` (sent) | the blurred preview is `data-testid="photo-preview"` |
| File letter | button `Download <file name>` | |
| Failed upload | button `Retry upload` | |
| Composer | textbox `Write a letter`, buttons `Attach photo`, `Attach file`, `Send` | |
| Delete undo | `data-testid="snackbar"` with button `Undo` | |
| Dialog `Letter actions` | buttons `Delete for me`, `Delete for everyone`, `Cancel` | Delete for everyone appears only on your own letters while allowed |
| Dialog `Photo viewer` | the image, button `Close photo` | |
| Key change | region `Seal number changed`, `data-testid="key-change-warning"`, buttons `Compare seal numbers`, `Accept new seal number` | |
| Contact card | region `Contact card` (1200 px and wider) or dialog `Contact card` | buttons `Show seal number`, `Mute` or `Unmute`, `Block` or `Unblock`; the verified mark reads `Verified` |
| Dialog `Seal number` | `data-testid="seal-number"`, buttons `Mark as verified` or `Remove verification`, `Close` | the 12 groups separated by single spaces |
| Dialog `Mute letters` | radios `1 hour`, `8 hours`, `1 week`, `Always`, buttons `Mute`, `Cancel` | |
| Dialog `Block <name>?` | buttons `Block`, `Cancel` | |
| Blocked conversation | button `Unblock` | replaces the composer |
| Contacts | textbox `Find by username`, button `Find`, list `Contacts` | |
| Contacts | region `Lookup result` with button `Write a letter` | shows the username and a plain avatar, or the not-found copy |
| Contacts | `status` `Lookup status` | |
| Settings | textbox `New username`, button `Change username` | |
| Settings | button `Save profile`, switch `Read receipts`, radiogroup `Notification preview` with radios `Name and letter`, `Name only`, `No name or letter` | |
| Settings | link `Blocked contacts`, list `Blocked contacts` with buttons `Unblock <username>` | |
| Signed out | heading level 1 `Signed out` | |

The document title is `Airfold` when the Chats badge is zero and `(<n>) Airfold` otherwise, where `<n>` is the same number as the Chats badge.

### Interactions (DP-03, DP-05, DP-12, DP-21, DP-27, DP-29, DP-41, DP-43)

**Keyboard**

- Every control is reachable with Tab in reading order and shows a thick ink focus ring.
- On the sign-up steps, Tab goes field, then chip, then primary button. Enter in any field submits its step. Focus moves to the first field of each new step.
- On a recovery-check mistake, focus moves to the first wrong group field.
- In Contacts, Enter in Find by username runs the lookup. Focus then moves to the Lookup result region, whether it shows a card or the not-found copy. Write a letter opens or creates the conversation and puts focus in the composer.
- In an open conversation, Tab order is: header buttons, then each letter's buttons from oldest to newest, then the key-change warning buttons, then the composer textbox, Attach photo, Attach file and Send.
- In the composer, Enter sends and Shift+Enter starts a new line. After every send, by Enter or by the Send button, focus is back in the composer, which is empty.
- Every dialog (Letter actions, Photo viewer, Contact card, Seal number, Mute letters, Block) puts focus on its first control when it opens. Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Escape closes it. Closing by any means returns focus to the control that opened it.
- After Accept new seal number, focus goes to the composer.

**Pointer and touch**

- Tapping a row opens the conversation. Tapping a toast opens its conversation.
- A long press of half a second on a letter opens Letter actions. A press shorter than that does nothing.
- Tapping Open photo opens the Photo viewer.
- Tapping the dimmed backdrop of a dialog closes it, the same way Escape does.
- Every control is at least 44 by 44 pixels.

**Composer**

- Attach photo opens the browser's photo chooser (JPEG, PNG or WebP). Attach file opens a chooser for any file.
- A chosen attachment shows as a pinned slip above Send. Sending posts it with whatever text is in the composer as its caption.
- Send with an empty composer and no attachment does nothing.
- A second tap of Send while a letter is being sealed does nothing, because the composer has already been emptied into that one letter.

**Reading**

- When a conversation is open and the page is visible, its letters are marked read up to the newest one: when it opens, and whenever a new letter arrives while it stays open.
- A request is marked read the same way when opened, which by Business rules sends no receipt.

### Visual design (DP-44)

The direction is *the page is the object*: every screen is a sheet of aerogramme laid on a hot orange field.

- **Type.** One slab-serif face, Zilla Slab, for both headings and body. It is self-hosted with the app and never loaded from a font service. Display lines use its semibold weight, names in rows use its medium weight, and body text uses its regular weight. Each heading step is a quarter larger than the one below it. Everything is in sentence case, and nothing is set in capitals as a label.
- **Colour roles.**
  - Ground: a hot, saturated orange that runs floor to ceiling behind every screen.
  - Surface: a slightly lighter orange, used for folded-letter rows and form panels.
  - Ink: a near-black blue-black, used for text, rules, postmarks and solid buttons.
  - Muted: a deep burnt brown, for secondary text such as times and usernames.
  - Accent: the same ink. Text on an ink button or disc is the ground orange.
  - Letters, the hero sheet, banners and the key-change stub are pure white.
  - Every text and background pair meets WCAG 2.2 AA contrast.
- **Ornament.** The only ornament is the airmail stripe: alternating blue-black and orange diagonal bars around the edge of every white sheet, on every screen. Dotted fold perforations cross each sheet at its thirds. There are no hairline rules, glass panels, monospace labels, index numbers, cream paper, gradients or drop shadows beyond a single flat offset under each sheet.
- **Corners.** Only sheets have rounded corners, about the size of a fingertip. Everything inside a sheet is square.
- **Density.** Comfortable. Rows and paragraphs have generous breathing room, and nothing is cramped at 375 pixels.
- **Hero (landing).**
  - The orange field fills the window. A white sheet with 5:7 proportions covers the middle half of the width and starts about a fifth of the way down, so the window's bottom edge crops it.
  - The sheet has scalloped inner corners, the airmail stripe on its edge and one dotted fold line across it.
  - Centred inside, the heading sits on two staggered lines, very large (about five times body size on a desktop window).
  - Beneath it, the three hero lines run in a row at a small size, separated by small ink diamonds.
  - The hero postmark ring sits like a stamp in the sheet's top-right corner.
  - On the field above the sheet: an "Hp" monogram top left, the three links centred, and the solid ink Choose a username button top right.
  - On a phone, the sheet runs full width less a narrow margin, starts just below the top bar, keeps its scalloped top corners, and the heading is centred at about an eighth of the screen width.
- **Working screens.**
  - Conversation rows are folded letters in the surface orange, each with a real notched corner. The photo sits as a tipped-in plate, and the unread count is an ink disc with an orange numeral.
  - Each postmark is a round ink ring holding its label and a time in tabular figures.
  - Send and other primary buttons are solid ink blocks.
  - Forms are printed panels with filled orange input wells and no outlined boxes.
  - A field error is a smaller tear-off slip in ink with orange text, pinned directly under its field.
  - The empty list is one folded blank sheet carrying the empty copy.
  - Outage banners are a white seam across the full width at the top, set in ink.
  - The key-change warning is a white stub with a perforated left edge.
  - The footer is the gummed back flap, printed with the Halfpenny Post Co. return address.
- **Images.** All imagery (plain avatar, monogram, postmarks, stripe) is drawn in code as vector shapes. No image files are fetched from anywhere else.

### Motion and effects (DP-42, DP-43)

Motion means one thing: a letter changed hands. Easing is fast out and soft in, settling with no bounce. All motion runs on the page's own clock, so it stops while that clock is paused.

**Send (the fold and postmark signature)**, starting the moment Send is pressed:

1. The composer's lower third, holding the written text, folds up along its dotted line, turning over on its horizontal edge through half a turn. This takes the first third of a second.
2. Starting about an eighth of a second in, the top third folds down over it, finishing just under half a second in.
3. The gummed flap closes over the next fifth of a second.
4. The folded letter then shrinks into its row over the next four tenths of a second.
   - At 768 pixels and wider, the row is the conversation's row, moved to the top of the list. It is the same element that slides into place, not a copy.
   - Under 768 pixels, where the list is hidden, the letter shrinks into its place at the foot of the letter sheet.
   - The whole sequence ends between 0.9 and 1.2 seconds after Send.
5. When the server accepts the letter, the postmark strikes onto it. The ring starts slightly enlarged and level, and in about a fifth of a second settles to full size, tilted 8 degrees anticlockwise. The label reads Sent with the server's held time.

**Later state changes.**

- **Re-strike.** When a letter becomes Delivered or Read, or is returned, its postmark re-strikes on both people's screens in the same fifth of a second. The new time's digits change one at a time from left to right, finishing within half a second.
- **Opening a received letter.** When a conversation opens with unopened letters, the newest of them unfolds: the same folds in reverse order, in under half a second.
- **Loading.** While a list or sheet loads, its stripe edge steps one bar width at a time, at most four steps a second. It stops the moment loading ends.
- **Dialogs and toasts.** Dialogs and toasts fade and rise in within a fifth of a second and leave the same way.
- **Press feedback.** Buttons darken instantly on press.
- **After reload.** Every postmark shows its stored state and time with no motion.
- **No loops.** Nothing else moves. There are no idle loops, shimmer or decorative movement.

**Reduced motion.** When the browser asks for reduced motion:

- Nothing turns, scales, slides or loops, and the loading stripe stands still.
- On Send, the composed letter is replaced by its folded row in one step, with a fade of at most 120 milliseconds, and the postmark appears already in place.
- A re-strike becomes an instant text change, and a thick ink "inked" underline appears under the label for 2 seconds.
- The chip, dialog and toast changes are fades of at most 120 milliseconds.
- Announcements and stored states are identical to the full-motion path.

### Feedback states (DP-03, DP-05, DP-12, DP-14, DP-17, DP-21, DP-23, DP-24, DP-25, DP-26, DP-29, DP-32, DP-35, DP-36)

All copy below is exact, with straight apostrophes and three full stops where shown. Announcements go to the named `status` region at the same moment the screen changes, and carry the same characters.

- `<time>` and `<date>` are formatted as Business rules time rules state.
- `<limit>` is the size cap in megabytes (1,048,576 bytes each), rounded down to one decimal place, for example `25.0 MB` with the default cap.
- `<username>` is the lowercase username.
- `<first line>` is the letter's first line of text cut to 80 characters. For a photo letter with no caption it is `Photo`, and for a file letter it is `File`.

**Postmark labels** (`postmark-label`):

| State | Label | `data-delivery` |
|---|---|---|
| in the outbox or uploading | `Sending` | `sending` |
| held | `Sent` | `sent` |
| collected | `Delivered` | `delivered` |
| read | `Read` | `read` |
| upload failed, never posted | `Failed` | `failed` |
| returned | `Returned: not collected in 30 days` | `failed` |
| a received letter | `Received` | the stored state |

Only Sending and upload-failed letters show no time.

**Letter updates** (`status` `Letter updates`):

- posted: `Sent. Held for <name> until they collect it.`
- delivered: `Delivered to <name> at <time>.`
- read: `Read by <name> at <time>.`
- returned: `Your letter to <name> was returned: not collected in 30 days.`
- upload finished: `Upload finished.`
- upload failed: `Couldn't upload. Your letter wasn't sent.` (the same sentence shows inside the failed letter, above Retry upload)
- a letter arrives in the open conversation: `New letter from <name>.`
- the delete snackbar reads `Letter deleted.`, with Undo. Undo announces `Letter restored.`

**Deleted for everyone:** the recipient sees `This letter was deleted.` and the sender sees `You deleted this letter.`

**Connection bars:**

- `Connecting...` appears after the connecting delay (Business rules).
- `Updating... <n> letters` shows while held letters are collected, or `Updating... 1 letter` when there is one. It stays for at least one second.

**Pending and errors**

While any request a person started is pending, the button that started it is disabled and marked busy. Its name does not change. Any unexpected failure of a non-letter action shows the slip `Something went wrong. Try again.` under that button.

| Context | Copy |
|---|---|
| Availability chip | `Available`; `Taken`; `Use 3 to 32 characters.`; `Use only lowercase letters, numbers, underscores and dots.`; `Start with a letter.`; `Don't end with a dot.` |
| Recovery check, wrong group | `That group doesn't match your recovery code.` |
| Display name empty | `Enter a display name.` |
| Profile photo not stored | `Your photo couldn't be saved. You can add it in Settings later.` |
| Restore failed | `That username and recovery code don't match.` |
| Too many restore attempts | `Too many tries. Wait a minute and try again.` |
| Signed-out screen | `This account was restored in another browser, so this browser is signed out.` |
| Lookup found | announces `Found <username>.` |
| Lookup not found | `No one with that username.` (also announced) |
| Conversation not found | `We couldn't find that letter.` |
| Too long | `Letters can be up to 8,000 characters.` (Send disabled) |
| File over cap | `This file is larger than <limit> and can't be sent.` |
| Wrong photo type | `Choose a JPEG, PNG or WebP photo.` |
| Other refused letter | `This letter couldn't be sent.` |
| Corrupted attachment | `Attachment corrupted` (no download is offered) |
| Attachment unavailable | `This attachment can't be opened right now.` |
| Outage banner | `Photos and files can't be sent or opened right now. Letters still go through.` |
| Key-change stub | `<name>'s seal number has changed. Letters to <name> are paused until you accept the new seal number.` |
| Key-change row in the sheet | `<name>'s seal number changed.` |
| Block dialog body | `<name> won't be able to reach you. Letters they send while blocked are never delivered.` |
| Blocked conversation | `You blocked <name>.` |
| Username cooldown | `You can change your username again on <date>.` |
| Username same | `That's already your username.` |
| Username changed | `Your username is now <username>.` (announced in `Letter updates`) |
| Toast, Name and letter | `<name>: <first line>` |
| Toast, Name only | `<name>` |
| Toast, No name or letter | `New letter` |

**Empty states:**

| List | Copy |
|---|---|
| Chats | `No letters yet. Find someone by their exact username.` |
| Requests | `No letter requests.` |
| Contacts | `No contacts yet.` |
| Blocked contacts | `You haven't blocked anyone.` |
| Conversation with no letters | `Nothing written yet. Your first letter is sealed before it leaves this page.` |

**Field errors and outage.**

- A field error is the tear-off slip under its field. The field references the slip as its description. The copy is the chip or slip copy above, mapped from the API's reason codes.
- The outage banner appears whenever any request answers 503 `storage_unavailable`, and on load when health reports unavailable. It stays until a later storage request succeeds or health reports ok.
- Toasts never take focus. Each stays for the toast duration and sits in the `Notifications` region.

## Backend

### API (DP-02, DP-04, DP-06, DP-09, DP-10, DP-15, DP-19, DP-20, DP-22, DP-24, DP-26, DP-28, DP-30, DP-31, DP-32, DP-34, DP-36, DP-38)

**Conventions**

- **Bodies.** All bodies are JSON (`Content-Type: application/json`) except blob content. Timestamps are ISO 8601 UTC with milliseconds. Ids are lowercase UUID v4 strings. Binary values are base64url (URL-safe alphabet, no padding).
- **Errors.** Every error body is `{"error":"<code>"}`, with extra fields only where shown. Validation errors are `422 {"error":"invalid","fields":{"<field>":"<reason>"}}`.
- **Error order.** One order applies to every endpoint:
  1. the boundary checks in Server boundary (413, 415, 403 `cross_origin`);
  2. `401 {"error":"unauthenticated"}`;
  3. `404 {"error":"not_found"}` for anything unknown or not the caller's, including ids inside request bodies;
  4. `403`;
  5. a replay of a client-generated id returns its stored response;
  6. `409` state conflicts. On `POST /api/letters`, when several hold at once, the first in this list wins: `letter_id_conflict`, `request_not_accepted`, `contact_blocked`, `seal_change_unaccepted`, `recipient_key_changed`, `attachment_not_stored`, `attachment_in_use`;
  7. `413` and `422` validation;
  8. `503 {"error":"storage_unavailable"}`, only on the calls Services lists for a storage outage.

  The rows below list only each endpoint's own extra errors.
- **Session.** `airfold_session` is an HttpOnly, `SameSite=Lax`, `Path=/` cookie. Every endpoint needs it except health, config, availability, sign-up, recover and the grading routes.

**Records**

Account:

```
{"id","username","key_id","public_key","settings":{"read_receipts":true,"preview":"name_and_letter"|"name_only"|"none"},"profile":<sealed profile>|null,"username_changed_at":<ts>|null,"created_at":<ts>}
```

Sealed profile:

```
{"iv","ciphertext","photo_blob_id":<id>|null}
```

Conversation, as the caller sees it:

```
{"id","status":"accepted"|"request","peer":{"id","username","key_id","public_key","seal":"verified"|"unverified"|"changed","profile":<sealed profile>|null},"unread":<n>,"muted_until":<ts>|"always"|null,"blocked":<bool>,"last_letter":<letter>|null,"updated_at":<ts>}
```

`peer.profile`, and the `profile` that `GET /api/lookup` returns, are null unless the caller and that account share a conversation that is accepted for both of them. The person who started a conversation counts as having accepted it; the other person accepts it only with Accept. So a request recipient, and a starter whose letter is still a request for the other person, both get null, as does anyone with no conversation with that account. Otherwise it is the account's current sealed profile, or null if they have never saved one.

Letter:

```
{"id","conversation_id","seq","sender_id","recipient_id","class":"letter"|"control","state":"sent"|"delivered"|"read"|"failed","failure":null|"returned","held_at":<ts>,"delivered_at":<ts>|null,"read_at":<ts>|null,"returned_at":<ts>|null,"retracted_at":<ts>|null,"can_retract":<bool>,"sender_key_id","recipient_key_id","iv":<b64>|null,"ciphertext":<b64>|null,"attachment_id":<id>|null}
```

- `iv` and `ciphertext` are present only for the recipient, and only while the letter is held and not retracted. Otherwise they are null.
- `seq` is one exchange-wide increasing number.

Blob:

```
{"id","kind":"image"|"file"|"photo","size":<bytes>,"state":"uploading"|"stored"}
```

**Endpoints**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok"}`; `200 {"status":"unavailable"}` while object storage is unreachable | none |
| `GET /api/config` | none | `200 {"attachment_max_bytes":<n>,"timers":{"undo_ms","connecting_delay_ms","availability_debounce_ms","retry_base_ms","retry_cap_ms","toast_ms"},"grading":<bool>}` | none |
| `GET /api/usernames/:username/availability` | none | `200 {"username":"<lowercased>","available":<bool>,"reason":null\|"taken"\|"length"\|"characters"\|"first_character"\|"last_character"}` | none |
| `POST /api/accounts` | `{"username","public_key","recovery_verifier","key_backup":{"iv","ciphertext"}}` | `201 <account>` plus the session cookie | `409 username_taken`; 422 fields `username` (reason codes as availability), `public_key`, `recovery_verifier` or `key_backup` with reason `invalid` |
| `GET /api/me` | none | `200 <account>` | none |
| `PUT /api/me/profile` | `<sealed profile>` | `200 <account>` | 404 for a photo blob that isn't the caller's; `409 attachment_not_stored`; 422 `iv` or `ciphertext` `invalid`; 503 |
| `PATCH /api/me/settings` | `{"read_receipts"?:<bool>,"preview"?:<enum>}` | `200 <account>` | 422 `invalid` |
| `PATCH /api/me/username` | `{"username"}` | `200 <account>` | `409 {"error":"username_cooldown","retry_at":<ts>}`; `409 username_taken`; 422 field `username` with the availability reason codes or `same` |
| `POST /api/recover` | `{"username","recovery_verifier","public_key","key_backup":{"iv","ciphertext"}}` | `200 {"account":<account>,"key_backups":[{"key_id","iv","ciphertext","created_at"}]}` (every earlier key, oldest first) plus the session cookie | `401 recovery_failed` (unknown username or wrong verifier, the same answer); `429 too_many_attempts`; 422 `invalid` |
| `GET /api/lookup?username=` | none | `200 {"id","username","key_id","public_key","profile":<sealed profile>\|null}` | 404 |
| `GET /api/accounts/:id/keys` | none | `200 {"keys":[{"key_id","public_key","created_at","current":<bool>}]}`, oldest first | 404 |
| `POST /api/conversations` | `{"peer_id"}` | `201 <conversation>`; `200` with the existing one for the same pair | 404; 422 `peer_id` `self` |
| `GET /api/conversations?status=accepted\|request` | none (default `accepted`) | `200 {"conversations":[...]}`, newest `updated_at` first | none |
| `GET /api/conversations/:id` | none | `200 <conversation>` | none |
| `POST /api/conversations/:id/accept` | `{}` | `200 <conversation>` | `409 not_a_request` |
| `DELETE /api/conversations/:id` | none | `204` | `409 not_a_request` |
| `POST /api/conversations/:id/read` | `{"through_seq":<n>}` | `200 <conversation>` | 422 `invalid` |
| `PUT /api/conversations/:id/mute` | `{"duration":"1h"\|"8h"\|"1w"\|"always"\|"off"}` | `200 <conversation>` | 422 `invalid` |
| `GET /api/conversations/:id/letters?before_seq=&limit=` | none (limit 1 to 200, default 50) | `200 {"letters":[...]}`, ascending `seq` | 422 `invalid` |
| `PUT /api/contacts/:account_id/seal` | `{"key_id","verified":<bool>}` | `200 {"account_id","key_id","seal"}` | 404 when the caller has no conversation with them; `409 {"error":"stale_key","key_id":<current>}` |
| `POST /api/letters` | `{"id","conversation_id","class","recipient_key_id","iv","ciphertext","attachment_id"?}` | `201 <letter>`; `200` with the stored letter on replay | `409 letter_id_conflict`; `409 {"error":"recipient_key_changed","key_id":<current>}`; `409 seal_change_unaccepted`; `409 request_not_accepted`; `409 contact_blocked`; `409 attachment_not_stored`; `409 attachment_in_use`; 422 `invalid`; 503 for an attachment letter whose blob is `stored` |
| `GET /api/letters/:id` | none | `200 <letter>` | none |
| `POST /api/letters/:id/retract` | `{}` | `200 <letter>` (repeat: 200, unchanged) | `403 not_sender`; `409 retract_window_closed` |
| `GET /api/inbox` | none | `200 {"letters":[...]}`: every letter held for the caller, ascending `seq` | none |
| `POST /api/inbox/ack` | `{"through_seq":<n>}` | `200 {"delivered":<n newly delivered>}` | 422 `invalid` |
| `POST /api/blobs` | `{"id","kind","size"}` | `201 <blob>`; `200` on replay | `409 blob_id_conflict`; `413 {"error":"too_large"}` when `size` is over the cap; 422 `kind` `unsupported` or `size` `invalid` |
| `PUT /api/blobs/:id/content` | raw bytes, `Content-Type: application/octet-stream` | `200 <blob>` with `state:"stored"` | 404 unless the caller owns it; `409 already_stored`; 413 when the body is longer than the declared size; `422 size_mismatch` when shorter; 503 |
| `GET /api/blobs/:id` | none | `200` with the sealed bytes | 503 |
| `GET /api/blocks` | none | `200 {"blocks":[{"account_id","username","blocked_at"}]}` | none |
| `PUT /api/blocks/:account_id` | `{}` | `200 {"account_id","username","blocked_at"}` (repeat: 200, same) | 404; 422 `account_id` `self` |
| `DELETE /api/blocks/:account_id` | none | `204` (repeat: 204) | 404 |
| `GET /api/grading/dump` | none | `200 {"tables":{"<table>":[{<column>:<value>}]}}`: every stored row of every table, binary columns as base64url | 404 unless `GRADING=1` |
| `GET /api/grading/clock`, `POST /api/grading/clock` | POST `{"offset_ms":<integer, 0 or more>}` replaces the offset | `200 {"offset_ms":<n>,"now":<ts>}` | 404 unless `GRADING=1`; 422 `offset_ms` `invalid` |
| `GET /ws` | WebSocket upgrade, cookie auth | server-to-browser frames: `{"type":"letter","letter":<letter>}` for every new or changed letter for either participant, `{"type":"conversation","conversation":<conversation>}`, `{"type":"keys","account_id"}`, `{"type":"signed_out"}` | 401 before upgrade |

**Blob downloads.** A successful `GET /api/blobs/:id` always sends:

- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment`
- `X-Content-Type-Options: nosniff`
- `Cache-Control: private, no-store`

**Field validation for `POST /api/letters`:**

- `id` is a UUID v4.
- `class` is `letter` or `control`.
- `iv` decodes to 12 bytes.
- `ciphertext` decodes to a length that is a multiple of 160 plus 16, at most 64,016 bytes (that limit is allowed).
- `attachment_id` is allowed only on class `letter`.

### Business rules (DP-01, DP-02, DP-04, DP-06, DP-08, DP-09, DP-10, DP-11, DP-13, DP-15, DP-16, DP-18, DP-19, DP-20, DP-22, DP-23, DP-26, DP-28, DP-30, DP-31, DP-32, DP-34, DP-36)

**Usernames.**

- A username is 3 to 32 characters (both allowed). It uses only `a` to `z`, `0` to `9`, `_` and `.`, starts with a letter, and doesn't end with `.`.
- Input is lowercased before every check, so `Ada.Lovell` and `ada.lovell` are the same name.
- Availability reasons are checked in this order: `length`, `characters`, `first_character`, `last_character`, then `taken`.
- `taken` covers names in use, names on hold and the reserved names in Seed data.
- When several sign-ups or changes race for one name, exactly one wins. The others get `409 username_taken`.
- A username change is refused with `username_cooldown` until 7 days have passed since the last change. `retry_at` is that moment. Sign-up does not start the cooldown.
- The released name is held for 14 days: lookup answers 404, availability answers `taken`, and nobody (including its former owner) can claim it. When the 14 days end it is free.

**Sign-up and sessions.**

- The browser creates the identity key pair and the recovery code before sign-up. It sends only the public key, the recovery verifier and the sealed key backup.
- The server stores the verifier only as a SHA-256 hash with a random 16-byte salt, compared in constant time.
- Session tokens are random and stored only as hashes.
- Sign-up never stores a display name or photo. The browser seals those into the profile afterwards.

**Recovery.**

- `POST /api/recover` with a matching username and verifier:
  - makes the new public key current;
  - records the old key in the key history;
  - stores the new key backup;
  - revokes every other session for that account, whose sockets receive `signed_out` and close;
  - sets a new cookie;
  - returns the earlier key backups.
- The restored browser unseals those backups so it can open letters held for the earlier keys.
- The restored browser sends a new profile key (see Conversations and requests) to every accepted contact.
- A revoked browser gets 401 on its next request and shows the signed-out screen.
- After 5 failed attempts for one username within 60 seconds, every further attempt for that username, right or wrong, answers 429 until 60 seconds after the first failure in that window.

**Sealing scheme.** All of this happens in the browser with Web Crypto.

- **Identity keys.**
  - Each key is an ECDH P-256 key pair. The private key is kept in the browser's IndexedDB as a non-extractable key.
  - `public_key` is the raw 65-byte uncompressed point. The server rejects anything that isn't a valid P-256 point.
  - `key_id` is the first 12 bytes of SHA-256 of the raw public key, base64url (16 characters).
- **Conversation key.**
  - ECDH between your private key and the peer's public key gives 32 shared bytes.
  - HKDF-SHA-256 then derives a 32-byte AES-256-GCM key. The salt is SHA-256 of the two account ids, sorted as strings and joined with `:`. The info is the UTF-8 text `airfold/v1/msg`.
  - The key pair used is the sender key and recipient key named in the letter's `sender_key_id` and `recipient_key_id`. The server sets `sender_key_id` to the sender's current key.
- **Sealing a letter.**
  - The body is UTF-8 JSON, padded with one `0x80` byte and then `0x00` bytes up to the next multiple of 160 bytes. Padding is always added, so a 160-byte body pads to 320.
  - It is encrypted with AES-256-GCM, a random 12-byte IV, no additional data and the 16-byte tag appended.
  - `iv` and `ciphertext` are base64url.
- **Body shapes.**
  - `{"v":1,"kind":"text","text":<string>}`
  - `{"v":1,"kind":"image","text":<caption or "">,"attachment":<A>}`
  - `{"v":1,"kind":"file","text":"","attachment":<A>}`
  - Class `control` carries `{"v":1,"kind":"profile","profile_key":<b64 32 bytes>}`.
  - `<A>` is `{"blob_id","key","iv","digest","size","name","type","width"?,"height"?,"thumb"?}`:
    - `key` (32 bytes) and `iv` (12 bytes) are the attachment's own random AES-256-GCM key and IV;
    - `digest` is SHA-256 of the sealed bytes;
    - `size` is the unsealed byte count;
    - `name` is the original file name;
    - `type` is the MIME type;
    - photos also carry `width` and `height` and `thumb`, a base64url JPEG no larger than 32 pixels on its long edge.
- **Text length.** Letter text is at most 8,000 characters (allowed), counted as Unicode code points.
- **Attachment sealing.** An attachment is the raw file bytes sealed with its own key and IV, with no padding. Its sealed size is the file size plus 16 bytes.
- **Profile.**
  - The profile JSON is `{"v":1,"display_name":<1 to 40 characters>,"photo":null|{"blob_id","key","iv","digest","type"}}`.
  - It is padded like a letter and sealed with the account's random 32-byte profile key and a random IV.
  - The profile key travels only inside control letters.
- **Worked example.** The body `{"v":1,"kind":"text","text":"Hello from Lisbon"}` is 48 bytes and pads to 160. Its ciphertext is 176 bytes, which is 235 base64url characters. Its IV is 16 base64url characters.
- **Recovery code.**
  - 20 random bytes written as 32 Crockford base32 characters (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`).
  - Shown as 8 groups of 4 joined by `-`, for example the shape `7K2M-Q9XD-...`.
  - Its canonical form is uppercase with hyphens and spaces removed, with `I` and `L` read as `1` and `O` read as `0`.
  - HKDF-SHA-256 over the canonical form's UTF-8 bytes, with salt `airfold/v1/recovery`, gives the 32-byte `recovery_verifier` (info `airfold/v1/recovery-verifier`) and the 32-byte backup key (info `airfold/v1/key-backup`).
  - `key_backup` is the PKCS#8 private key sealed with the backup key and a random IV. The browser exports the private key once, at creation, to make it, then stores the key only as non-extractable.
- **Seal number.**
  - Sort the two raw public keys bytewise, concatenate them, and take SHA-512.
  - For group i from 0 to 11, read bytes 5i up to 5i+5 as a big-endian integer, take it modulo 100000 and zero-pad it to 5 digits.
  - Show the 12 groups separated by single spaces.

**Seal status.**

- For each contact, the server records which of their key ids the viewer has accepted, and whether it is verified.
- The first time a conversation is created or received, the peer's current key is recorded as accepted and `unverified`.
- `PUT /api/contacts/:account_id/seal` with the current `key_id`:
  - with `verified:true` it sets `verified`;
  - with `verified:false` it sets `unverified` (this is how a changed key is accepted);
  - with any other `key_id` it answers `stale_key`.
- The status is `changed` whenever the contact's current key differs from the accepted one, whatever the earlier status was.
- Posting to a contact whose status is `changed` answers `seal_change_unaccepted`.
- Posting with a `recipient_key_id` that isn't the recipient's current key answers `recipient_key_changed`.
- The browser keeps such letters in Sending behind the key-change stub. After Accept new seal number, it reseals them to the new key and posts them under their same ids.
- Accepting a new seal number also sends that contact your profile key again.

**Conversations and requests.**

- A conversation belongs to exactly one pair of accounts.
- Its starter sees it as `accepted`. The other person sees it as `request` from its first held letter until they accept. It does not appear for them before any letter.
- While it is a request:
  - the recipient sees the peer's username and a plain avatar and no profile (the profile rule in API records);
  - the recipient cannot post (`request_not_accepted`);
  - reads record no receipt.
- **Accept** makes it accepted. The recipient's browser then sends a profile control letter. When the starter's browser receives that and has not yet sent its own profile key, it replies with one, so each side opens the other's profile.
- **Delete** hides it from the recipient and sends nothing to the sender. If the sender writes again, it comes back as a request showing only the new letters.
- **Block** on a request blocks the sender and hides the conversation.
- Control letters are queued, collected and delivered like letters. They never count as unread, never raise toasts and never show a postmark.

**Letter delivery states.**

| From | To | When |
|---|---|---|
| (none) | `sent` | an accepted `POST /api/letters`; `held_at` is server now |
| `sent` | `delivered` | the recipient acks a `through_seq` at or above it; `delivered_at` is server now, set once; the held ciphertext is deleted in the same step |
| `delivered` | `read` | the recipient's read marker covers it, the conversation is accepted for the recipient, and both people have read receipts on at that moment; `read_at` is server now |
| `sent` | `failed` with `failure:"returned"` | 30 days after `held_at` without an ack; the ciphertext and any attachment object are deleted; `returned_at` is the moment it was returned |

- Every other change is impossible:
  - acking a delivered, read, returned or dropped letter changes nothing and is not counted;
  - a read marker never touches a `sent` or `failed` letter;
  - `delivered_at` and `read_at` never change once set.
- A read recorded while a request, or while either side had receipts off, leaves the letter `delivered` for good.
- Settings changes affect only reads recorded after them.
- The browser alone adds `sending` (in the outbox or uploading) and upload `failed` (never posted). The server has no row for either.
- Returns are applied on every read of the affected rows and by a sweep at least every 10 seconds, which pushes the change over the socket.

**One letter per client letter id.**

- The browser makes each letter's `id` once, when it is composed.
- The same sender posting the same `id` with the same body gets `200` and the stored letter, before any state check.
- A different body (other conversation, class, ciphertext or attachment) with that `id`, from anyone, gets `letter_id_conflict`.
- Of simultaneous posts with one `id`, exactly one creates the row (201). The rest get 200 with it.
- Blob ids follow the same rule with `blob_id_conflict`.

**Held queue.**

- `GET /api/inbox` returns the caller's held letters in ascending `seq`, letters from request senders included.
- Each new held letter is pushed to the recipient's open sockets within 2 seconds.
- An open browser collects (fetch, open, ack through the highest seq) within 2 seconds of the push, and on every load and reconnect.

**Outbox.**

- The browser keeps unposted letters in IndexedDB, so they survive reloads. It posts them one at a time in the order they were written.
- On a network error or a 5xx other than `storage_unavailable`, it retries the same letter after the retry base delay, doubling each time up to the retry cap: 1 s, 2 s, 4 s, 8 s, 16 s, 32 s, then 60 s with the defaults. It also retries at once when the browser comes back online or the socket reconnects.
- A `storage_unavailable` answer fails an attachment letter for good, until Retry upload.
- Any other 4xx leaves the letter showing the refused copy.

**Attachments and photos.**

- **Preparing a photo.** A photo (JPEG, PNG or WebP) is drawn and re-encoded as JPEG in the browser:
  - shrunk so its long edge is at most 2048 pixels, never enlarged;
  - with no EXIF, location or camera metadata;
  - with its `thumb` made the same way.
  A file is sent as-is.
- **Size cap.** The cap is `ATTACHMENT_MAX_BYTES` on the sealed size (default 26,214,400 bytes; the cap itself is allowed). The browser refuses a file whose sealed size would exceed it before making any request.
- **Steps.**
  1. `POST /api/blobs` declares the kind and sealed size. Over the cap answers 413 and nothing is stored.
  2. `PUT .../content` streams exactly the declared bytes to object storage. A longer body is cut off and refused with 413 and nothing is kept.
  3. The server then reads back the stored object's size. It marks the blob `stored` only when that size equals the declared size; otherwise it deletes the object and answers 503.
  4. Only then does the browser post the letter.
- **Posting checks.** `POST /api/letters` with an `attachment_id` checks that the blob:
  - belongs to the sender (otherwise 404);
  - is kind `image` or `file`;
  - is `stored` in the database (otherwise `attachment_not_stored`, without contacting object storage);
  - is confirmed by object storage at its declared size at that moment (an object that is missing or at another size answers `attachment_not_stored`; unreachable storage answers 503);
  - is not on another letter (otherwise `attachment_in_use`).
- **What the person sees.** Until the letter is posted, the letter reads Sending and shows an uploading line. A failed upload or post leaves no letter row. The browser shows the upload-failed copy and Retry upload, which uses the same letter id.
- **Profile photos** are kind `photo` and are attached through `PUT /api/me/profile`. When `photo_blob_id` is not null, that call checks the blob the same way: the caller's (otherwise 404), `stored` in the database (otherwise `attachment_not_stored`, without contacting object storage), then confirmed by object storage at its declared size at that moment (missing or another size: `attachment_not_stored`; unreachable storage: 503).
- **Digest check.** The recipient's browser checks SHA-256 of downloaded bytes against `digest` before unsealing. A mismatch discards the bytes and shows the corrupted copy.
- **Deleting attachment objects.** Retracting or returning a letter deletes its attachment object.

**Participant access.**

- A conversation, its letters, its read and mute routes, and the image and file blobs on its letters are visible only to its two participants.
- An unattached image or file blob is visible only to its owner. A `photo` blob is visible to its owner and to anyone who would receive the owner's non-null profile under the profile rule in API records (a conversation with the owner that is accepted for both of them).
- Everyone else, signed in or not part of it, gets the same `404 {"error":"not_found"}` as for an id that never existed. This includes ids in bodies (`peer_id`, `conversation_id`, `attachment_id`, `photo_blob_id`).
- Lookup never returns the caller.

**Unread counts.**

- A conversation's `unread` is the number of class `letter` letters to the viewer that are `delivered` or `read`, are not covered by the viewer's read marker, and are not retracted. It is computed from stored rows on every read.
- The Chats badge and the document title show the sum over accepted conversations, muted ones included. Requests count only in the Letter requests link, as conversations.
- Badges change at once on local actions and within 2 seconds of a pushed change. After reload they equal the API.

**Deleting.**

- **Delete for me** only touches this browser. The letter hides at once with the snackbar. If the undo window ends without Undo, the letter is removed from this browser's store for good, and rows skip it when choosing a last letter. A reload before the window ends keeps the letter.
- **Delete for everyone** is `POST /api/letters/:id/retract`:
  - only the sender may retract (another participant gets `not_sender`);
  - it is allowed while server now is before `held_at` plus 24 hours; at or after that the answer is `retract_window_closed`;
  - it sets `retracted_at`, deletes the held ciphertext and any attachment object, and pushes the change to both people.
- `can_retract` is true exactly when a retract by the caller would succeed now. Opening Letter actions refetches the letter, and Delete for everyone appears only when `can_retract` is true.

**Blocking.**

- While A has blocked B:
  - B's posts to A are answered as usual (201, state `sent`) but stored without ciphertext and never queued, so they never become delivered and are returned after 30 days like any uncollected letter;
  - B gets no signal;
  - A cannot post to B (`contact_blocked`).
- Unblocking lets letters posted afterwards flow normally. Letters posted during the block never arrive.
- A blocked conversation stays in A's Chats with the blocked copy and Unblock.

**Notifications and mute.**

- A toast appears when a class `letter` letter arrives in an accepted conversation that is not open on screen and not muted. It is worded by the viewer's `preview` setting.
- `1h`, `8h` and `1w` mute until server now plus 1 hour, 8 hours or 7 days. `always` mutes until undone, and `off` unmutes.
- Mute never changes unread counts.

**Time rules.**

- Every server timestamp and every server-side rule uses server now: the real clock plus the grading offset. This covers holds, returns, the retract window, cooldown, name holds, mutes and restore attempts.
- Browsers show times in the viewer's local time zone with tabular figures:
  - `<time>` is `HH:MM` in 24-hour form when the date is today in that zone, otherwise `D Mon HH:MM` (for example `3 Nov 09:05`);
  - `<date>` is `D Mon YYYY`.

### Services (DP-15, DP-19, DP-22, DP-24)

- **PostgreSQL** holds:
  - accounts (lowercase username, sealed profile, current and earlier public keys with times, the salted verifier hash, key backups, settings, username change times, name holds);
  - session token hashes;
  - conversations with each side's status, read marker, mute and seal records;
  - letters with their client ids, seq, state, server timestamps and ciphertext only while held;
  - blobs with kind, declared size and state;
  - blocks.

  No column ever holds a letter body, display name, file name, photo or private key in the clear. The app applies its schema on every start without failing when it already exists.
- **MinIO** holds every sealed attachment and profile photo:
  - the object key is `blobs/<owner account id>/<blob id>`;
  - the bytes are exactly the sealed bytes the browser uploaded, at the declared size;
  - the bucket is `S3_BUCKET`, created on start if it is missing and kept private;
  - browsers never talk to MinIO; every byte goes through the app.

  When MinIO is unreachable:
  - exactly these calls answer `503 {"error":"storage_unavailable"}`, and only after every earlier check in the API error order passes: `PUT /api/blobs/:id/content`; `GET /api/blobs/:id`; `POST /api/letters` with an `attachment_id` whose blob is `stored`; `PUT /api/me/profile` with a `photo_blob_id` whose blob is `stored`;
  - `POST /api/blobs` only records the declaration and answers as it does with storage up; a letter or profile naming a blob that isn't `stored` answers `409 attachment_not_stored`, never 503;
  - on an instance that started with storage unreachable no blob can become `stored`, so the 503 a person meets is the content upload, which fails the letter as Feedback states;
  - health answers its unavailable body;
  - the browser shows the outage banner, and a failed upload shows its failed letter copy;
  - text letters, receipts, lookups and every other route keep working.

### Seed data (DP-01)

The database starts empty: no accounts, conversations or letters.

- **Reserved usernames.** Three names are permanently reserved and always answer `taken`: `halfpenny`, `postmaster` and `airfold`.
- **Test files.** Tests may attach these invented files:
  - `harbour-gps.jpg`: a 3000 by 2000 JPEG carrying GPS location and camera-make EXIF.
  - `tiny.png`: a 64 by 64 PNG.
  - `ferry-timetable.pdf`: 40,000 bytes.
  - `crate.bin`: 600,000 random bytes.

Every person, username and business in tests and examples is invented.

## Technical requirements

### Deployment (DP-38)

- **Runtime.** Node.js 22 LTS with npm, TypeScript compiled at build.
- **Run manifest.** `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- **Port.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- **Health.** `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}`, or the unavailable body from API.
- **Service workers.** There are none; everything works with service workers blocked.

### Configuration and secrets (DP-39, DP-45)

**Read at start from the environment:**

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_PORT`
- `GRADING`: `1` enables the grading routes and the sign-up page's `?skip_recovery_check=1`, which skips step 3. The grader sets it on every instance it starts.
- `ATTACHMENT_MAX_BYTES`

**Timers**, in milliseconds, with their defaults. They reach the browser through `GET /api/config`:

| Variable | Default | Controls |
|---|---|---|
| `UNDO_MS` | 5000 | the undo snackbar |
| `CONNECTING_DELAY_MS` | 2000 | the Connecting bar appears this long after the browser goes offline or the socket closes, whichever comes first |
| `AVAILABILITY_DEBOUNCE_MS` | 300 | the availability check runs this long after the last keystroke |
| `RETRY_BASE_MS` | 1000 | the outbox retry base |
| `RETRY_CAP_MS` | 60000 | the outbox retry cap |
| `TOAST_MS` | 4000 | the toast duration |

All browser timers run on the page's standard timers and clock. No credential or connection string is hard-coded, logged or sent to the browser.

### Server boundary (DP-39)

- **Origin.** The server serves the app and API from one origin. A state-changing request whose `Origin` header names another origin answers `403 {"error":"cross_origin"}`. Responses carry no permissive cross-origin headers.
- **Body limits.**
  - JSON bodies may be at most 131,072 bytes (allowed); larger answers `413 {"error":"too_large"}` before parsing.
  - A body on a JSON route without a JSON content type answers `415 {"error":"unsupported_media_type"}`.
  - Blob content is limited as Business rules state.
- **What it serves.** Only the built client and the API. Source files, the manifest, lockfiles, environment files and dot-files answer 404.
- **Boot.**
  - With MinIO unreachable, the server still starts and answers health with the unavailable body.
  - With PostgreSQL unreachable, it retries for up to 60 seconds and then exits with a non-zero status.

### Browser support and performance (DP-40, DP-43)

- **Browsers.** Current Chromium, Firefox and Safari. Graded in Chromium at 375 by 812, 768 by 1024 and 1280 by 800, with and without reduced motion, and with touch.
- **Speed.**
  - Chats is usable within 3 seconds of navigation on a local network.
  - A posted letter shows Sent within 1 second.
  - Live changes reach the other browser within 2 seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production tree from `npm ls --omit=dev --all --json`) with its version and licence, plus the Zilla Slab font and its licence.
- IF-03: Every shipped package (the production tree from `npm ls --omit=dev --all --json`) is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD, and fonts are under the SIL Open Font License.
- IF-04: The app stores state only in the provided PostgreSQL database and MinIO bucket (and the browser's own storage). There is no other database, cache, queue or state file on disk.
- IF-05: The running app makes no request to any host other than its PostgreSQL and MinIO, and the client loads no remote fonts, scripts, styles, images or analytics.
- IF-06: Sealing uses only the browser's built-in Web Crypto interface. No third-party cryptography package is shipped.
- IF-07: The provided service compose files and their dev credentials are left unchanged.

## Engineering standards

- The TypeScript is idiomatic and strictly typed, with no `any` on domain values.
- Names match this brief's terms: letter, held, delivered, read, returned, seal number, recovery code, exchange, request, blob.
- Each domain rule is decided in exactly one place in the source:
  - each delivery state change;
  - the unread count;
  - the username rules;
  - the retract window;
  - participant access;
  - the padding and sealing scheme.
- Every API error uses the one error shape from API.
- There are no abstractions with a single implementation, and no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code.
- There are no features, routes or settings beyond this brief.
- Tests or scripts the builder adds use the same published API and hooks as the brief.
