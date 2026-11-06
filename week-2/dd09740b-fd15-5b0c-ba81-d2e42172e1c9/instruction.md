# Northpier Studio Northpier inquiry desk

Build and deploy the Northpier inquiry desk. It is the public site and new-business desk of Northpier Studio, a small design and technology studio in Stockholm. Visitors browse eight case studies, send a project inquiry from `/start` and follow it on a private status page. Two studio accounts work the inquiry queue. The studio lead, Sana Holm, can do everything. The studio associate, Ole Berg, reviews inquiries, books and reschedules intro calls and keeps notes, but cannot close a deal. Intro calls go on one shared studio calendar. They keep to Stockholm working hours and skip Swedish closure days. The app stores everything in PostgreSQL and sends every email through the Mailpit SMTP server, using an outbox so that no change loses its email. Call emails carry a calendar invitation, and declining a booked call sends a cancellation. There is no starting codebase.

**Out of scope:**
- visitor accounts, public signup and password reset
- uploads, invoices, prices, payments and contracts
- reply threads and comments
- AI chat, journal, team, culture and careers pages
- analytics and third-party embeds
- video backgrounds, WebGL or moving three-dimensional canvases
- a native app
- any datastore besides PostgreSQL and any mail path besides SMTP to Mailpit

## Problem and users

Today the studio takes inquiries through its site and works them out of a shared inbox, and things go wrong:
- Two people answer the same lead, or one person's browser sends the same change twice.
- Intro calls get double-booked on the one studio calendar, set at 07:30 because someone's laptop was on UTC, or set on Midsummer Eve when the studio is closed.
- A cancelled call stays in the client's calendar because nobody sent a cancellation.
- An associate tells a client "we're on" when only the lead can commit the studio.
- A client email mentions an internal note or the name of whoever on the team clicked the button.
- Visitors never learn where their inquiry stands.

The studio lead pays for each of these in lost work and awkward follow-ups. The desk replaces the inbox with one pipeline per inquiry. Each change happens once, by someone allowed to make it, at a time the calendar can hold. The visitor's private page follows along, and every email says only what the visitor is meant to know.

| Role | Goal | Can do | Cannot do |
|---|---|---|---|
| Visitor (no account, occasional) | Send a project inquiry and follow it | Browse the landing page, case studies, services, contact and privacy pages; send an inquiry; open its status page through its private link | Read the queue, any inquiry detail, any note, any other inquiry, any studio account or anyone's email address; change anything through the status link |
| Studio lead (`lead`, daily) | Work the queue, book intro calls, win, decline and reopen inquiries | Everything an associate can do, plus `mark_won`, `decline` and `reopen` | Change an inquiry's reference, token, submitted fields or history, or skip a pipeline step |
| Studio associate (`associate`, daily) | Review new inquiries, book and reschedule intro calls, keep notes | Read the queue and every inquiry, add notes, `start_review`, `book_call`, `reschedule_call` | `mark_won`, `decline`, `reopen`, or anything a lead cannot do |

The server checks every permission on every request. Hiding a button is not enough.

## Journeys

| Route | Purpose | Who |
|---|---|---|
| `/` | Landing: hero, work grid, client index, closing statement | anyone |
| `/work/<slug>` | One case study in its client colour | anyone |
| `/services` | What the studio offers | anyone |
| `/contact` | Studio email and two offices with live local greetings | anyone |
| `/start` | The inquiry composer | anyone |
| `/inquiry/<token>` | The private status page | holder of the link |
| `/privacy-policy` | Privacy notice | anyone |
| `/studio/signin` | Studio sign in; honours `?next=<path>` | anyone |
| `/studio` | The queue, `?status=<tab>&q=<text>` | studio |
| `/studio/inquiries/<id>` | The queue beside one inquiry, `?status=<tab>&q=<text>` of the list it was opened from | studio |

Signed out, `/studio` and `/studio/inquiries/<id>` redirect to `/studio/signin?next=<that path and query>`. Without `next`, signing in lands on `/studio`. The app honours `next` only when it is `/studio` or begins with `/studio/` or `/studio?`, and has no scheme, host or leading `//`. Any other `next` is ignored and sign-in lands on `/studio`. Signing out returns to `/studio/signin`.

1. **A visitor sends an inquiry.**
   - Starts: signed out on the landing page.
   - The visitor opens the Halden Labs case study and presses "Start a project". They press the "I have a project" starter card, fill in the form, include an emoji in the message, and press "Send inquiry".
   - Ends: the form is replaced by the confirmation with the reference and the status link. "Open status page" shows a page reading "New", and Mailpit holds one confirmation email to the visitor.
2. **The associate reviews and books a call by keyboard.**
   - Starts: Ole Berg is signed out.
   - Ole signs in and, using only the keyboard, opens the visitor's inquiry from the New tab. He sees "Start review" but no "Decline", and presses "Start review". He opens "Book call" and enters a Saturday time, and the hours message appears under "Call time". He enters a Swedish closure day, and the closed-day message appears. He then enters a free studio day at 10:00 Stockholm time and confirms.
   - Ends: the panel closes and the pill reads "Call booked". The New count drops by one and the Call booked count rises by one. Ole is never offered "Mark won". After the status page's next recheck, the visitor's status page reads "Call booked" with the call time. The update email carries the calendar invitation, and it names neither Ole nor any note.
3. **The lead wins a deal after the call.**
   - Starts: Sana Holm is signed in on the Call booked tab.
   - Sana opens `NP-Q7LD4V`, whose call has taken place, and presses "Mark won".
   - Ends: the pill reads "Won", the Won count rises by one, the history gains one entry naming Sana Holm, and that inquiry's status page, at the fixture status link Seed data gives for `NP-Q7LD4V`, reads "Won".
4. **The lead declines a booked call, then reopens and rebooks.**
   - Starts: Sana Holm is signed in on an inquiry whose call is booked.
   - Sana presses "Decline", chooses "Budget does not fit" and presses "Confirm decline". The visitor receives an update with a cancellation for the call. The client then raises the budget. Sana presses "Reopen" and books a new call.
   - Ends: the status page reads "Call booked" again, and its history still lists the decline. The visitor's calendar invitations share one identity, and their sequence numbers rise across the decline and the reopen.
5. **The lead searches the queue and goes back.**
   - Starts: Sana Holm is on `/studio`.
   - She types "tidewell" in the search field, opens the matching inquiry, then presses the browser's Back button.
   - Ends: within one second of typing, the list shows only matching inquiries in the current tab, and every tab count equals the number of matching inquiries in that tab. `q` is in the address. Back restores the list with "tidewell" still in the search field. A search for `_` shows nothing.
6. **A visitor on a slow connection presses Send twice.**
   - Starts: the visitor is on a filled, valid composer form.
   - The visitor presses "Send inquiry" twice in quick succession.
   - Ends: one inquiry exists, one confirmation email arrives, and the confirmation shows its single reference.
7. **The associate forgets the password.**
   - Starts: Ole Berg is on the sign-in page.
   - Ole types a wrong password five times, then types the right one.
   - Ends: "Sign-in status" shows the sign-in-limit message, and Sana can still sign in from another browser.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Startup and health** The app answers `GET /api/health` as stated in Deployment once ready, applies its schema on every start, and every visitor page arrives as complete server-rendered HTML on first load.
- **DP-02 — Seed data** On first start the app seeds the two studio accounts, the eight cases and the seven inquiries of Seed data with their fixture status tokens into PostgreSQL exactly once, with each seeded inquiry's history and version consistent with its status, and seeding sends no email.
- **DP-03 — Seeded call times** The seeded call times of `NP-M3XB7R`, `NP-Q7LD4V` and `NP-W8DK5T` fall on the studio days Seed data names and are stored as the UTC instants of their stated Stockholm wall-clock times under the Stockholm daylight-saving rules of each call's own date.
- **DP-04 — Own origin only** Pages load nothing from another origin, and the app reaches no backing service besides PostgreSQL and the Mailpit SMTP server.
- **DP-05 — Out of scope** The source contains none of the features the opening paragraph lists as out of scope.
- **DP-06 — Studio sign in** `POST /api/auth/login` signs a seeded account in with the fixture password and returns a token that `GET /api/me` resolves to that user and role, a wrong password and an unknown email get the same sign-in refusal byte for byte, `POST /api/auth/logout` ends the token, and passwords are stored only as hashes.
- **DP-07 — Studio roles** Each studio account is a `lead` or an `associate`, Sana Holm is the lead and Ole Berg the associate, and the role appears in the login `user` and `GET /api/me` and cannot be changed by any request.
- **DP-08 — No public signup** There is no `/api/auth/signup` route and no request from outside creates a studio account.
- **DP-09 — Signed-in studio endpoints** A caller with no token or an invalid one is refused by `GET /api/me` and every `/api/studio/` endpoint with the sign-in-required refusal, leaking no email address and changing nothing.
- **DP-10 — Studio sign in page and redirects** Signed out, `/studio` and `/studio/inquiries/<id>` redirect to `/studio/signin?next=` that path, sign in lands on `/studio` or an allowed `next` while any other `next` is ignored, and "Sign out" returns to `/studio/signin`.
- **DP-11 — Sending an inquiry** `POST /api/inquiries` stores a valid inquiry as `new` at version 1 with a server-minted reference and status token and the email stored lowercase, answers 201, and queues exactly one confirmation email.
- **DP-12 — Inquiry validation** An invalid inquiry or a malformed body is refused with the first failing field's status, field and message from the Messages table, storing no row and sending no email.
- **DP-13 — Five inquiries an hour** One email address, compared case-insensitively, has at most five stored inquiries within the inquiry window, and the sixth is refused with 429 and a `Retry-After` header, storing and sending nothing.
- **DP-14 — Resending an inquiry** Repeating a stored inquiry's `Idempotency-Key` with the same body within the key lifetime answers 200 with the original response and creates, sends and counts nothing, while the same key with a different body, or a malformed key, is refused as the Messages table states.
- **DP-15 — One inquiry per double submit** Two identical requests carrying one `Idempotency-Key` sent together create exactly one inquiry, one confirmation email and one count toward the hourly limit, and both answer with the same reference.
- **DP-16 — Emails** Submission sends one confirmation email and each successful studio transition one update email with the pinned subjects, bodies and `Message-ID`, only to the inquiry's own address, within the delivery times and with the at-least-once delivery rule in Services, while a note, a replay or a refused request sends nothing.
- **DP-17 — Intro-call invitation** The update email for every `book_call` and `reschedule_call` carries one `intro-call.ics` REQUEST invitation with the inquiry's stable UID, the pinned sequence number, the call's UTC start and end and CRLF line endings, and no email other than these and the DP-67 cancellation carries a calendar part.
- **DP-18 — Private status read** `GET /api/inquiries/status/{token}` returns only the public inquiry with its dated history, never an email address, note, studio account or another inquiry, and an unknown token answers 404.
- **DP-19 — Status link is read-only** Every method other than `GET` and `HEAD` sent to a status link's API address or page answers 405 and changes nothing.
- **DP-20 — The pipeline** Status changes only through the Transitions table, each success raises the version by one and writes one history entry naming the studio account, `won` is final, and any other action gets the not-allowed refusal and changes nothing.
- **DP-21 — Lead-only actions** An associate's `mark_won`, `decline` or `reopen` gets the lead-only refusal and writes nothing, changes no version and sends no email, while an associate's `start_review`, `book_call` and `reschedule_call` succeed.
- **DP-22 — Allowed actions by role** `allowed_actions` and the inquiry page's action buttons list exactly the actions the Transitions table gives the caller's role from the current status, in table order.
- **DP-23 — Server-owned fields** Any reference, status token, status, version, role, author or actor sent in a request body is ignored, so no visitor or studio request changes them except through the pipeline.
- **DP-24 — Call window and hours** A `call_at` must be in the future, at most 90 days ahead and within studio hours judged in Stockholm time, as qualified in Business rules, each failure refused with its `call_at` message.
- **DP-25 — Quarter-hour starts** A call time that passes the hours and closure-day checks but does not start on a Stockholm quarter hour gets the quarter-hour refusal.
- **DP-26 — Stockholm wall-clock times** A `call_at` with an offset is taken as that instant and one without is read as Stockholm wall-clock time, so the stored UTC instant follows the Stockholm daylight-saving rule of the call's own date.
- **DP-27 — One call per slot** A booking or reschedule whose call overlaps another `call_booked` inquiry's call gets the overlap refusal, while back-to-back calls and a reschedule overlapping only the inquiry's own current slot are accepted.
- **DP-28 — Simultaneous bookings** Two bookings for overlapping slots on different inquiries sent together give exactly one success, one overlap refusal, one history entry and one email.
- **DP-29 — Won after the call** `mark_won` succeeds only once the stored call start has passed and otherwise gets the call-not-held refusal.
- **DP-30 — Declining** A lead's decline from `new`, `in_review` or `call_booked` needs one valid reason, frees any booked call slot, and the visitor's status read shows that reason.
- **DP-31 — Reopening a declined inquiry** A lead's `reopen` moves a `declined` inquiry to `in_review`, clears its decline reason and call time, raises the version by one, keeps the decline in the history and sends an update email.
- **DP-32 — Reopen window** `reopen` is accepted only while less than the reopen window has passed since the inquiry's latest decline, judged by the server clock, and from that edge on gets the window-closed refusal.
- **DP-33 — Changes from the latest version** A transition naming a stale or missing version gets 412, and unkeyed transitions sent together at the same version give exactly one success and one history entry.
- **DP-34 — Refusal order and shape** Every refusal except the health answers of Deployment uses the one error shape and follows the single refusal order in API, and no request answers with a server error.
- **DP-35 — The queue API** `GET /api/studio/inquiries` lists one tab (default `new`, or `all`) in the pinned sort orders, narrowed by `q` matched literally with an over-long `q` refused, and never carries a status token.
- **DP-36 — Counts follow the search** `counts` are computed over the inquiries matching `q`, each equals the length of that tab's narrowed list, `all` equals the sum of the five, and this holds after every transition, reopen and new inquiry.
- **DP-37 — Notes** Notes of 1 to 1000 characters from a lead or an associate list newest first and never change status or version, and blank or over-long notes are refused with their messages.
- **DP-38 — Case studies API** `GET /api/cases` returns the eight seeded cases in position order, and `GET /api/cases/{slug}` returns one case with the next two as `more`, wrapping around.
- **DP-39 — Visitor journey** A visitor sends an inquiry from a case study through the composer, sees the confirmation, opens the status page reading "New" and receives the confirmation email.
- **DP-40 — Studio pipeline journey** Sana Holm signs in, starts review on a new inquiry and marks `NP-Q7LD4V` won, and the pill, history, tab counts and the visitor's status page follow each step.
- **DP-41 — Associate journey** Ole Berg signs in, starts review and books a call on a new inquiry, and is never offered "Mark won", "Decline" or "Reopen".
- **DP-42 — Reopen journey** Sana Holm declines an inquiry with a reason and reopens it, and the visitor's status page reads "In review" with the decline still in its history.
- **DP-43 — Book call panel** The "Book call" and "Reschedule call" panels take the time in Stockholm time, state the studio hours and closure-day rules, and show an out-of-hours, closure-day, off-quarter or overlapping time's message under the "Call time" field without changing the inquiry.
- **DP-44 — Landing page and chrome** The landing page has the shared header, the hero, the rotating line, the eight-case work grid, the client index that dims the other rows while one is pointed at, the closing statement and the footer, and the current page's header link is underlined.
- **DP-45 — Case study page** Each `/work/<slug>` page is flooded with its theme colour and shows the industry, the client name as its title, the testimonial and two "More work" links.
- **DP-46 — Services, contact and privacy** The services, contact and privacy pages carry their pinned copy, and the contact offices end with live local greetings in their pinned formats.
- **DP-47 — Not-found page** Every unknown address, case slug and status token answers 404 with the not-found page.
- **DP-48 — Cookie card** The cookie card offers "Reject" and "Accept", the choice is remembered for a year in a first-party consent cookie, and the card does not return while that cookie is set.
- **DP-49 — Composer** `/start` offers three starter cards that select their services, a form that works before any script runs, a live counter that counts characters as the server does, a send control that is unavailable until every required field is valid and while a send is pending, an in-place confirmation whose "Copy link" copies the status link, and a refused send that keeps everything typed.
- **DP-50 — Status page** `/inquiry/<token>` shows the reference, the status label in display size, its status line, the message as literal text with its line breaks and a dated history oldest first, and picks up a studio change without a reload as qualified in Screens and layout.
- **DP-51 — Queue page** `/studio` shows the six tabs with counts, keeps the tab and `q` in the address so that Back and Forward restore them, narrows the list and counts as the search is typed, shows the pinned row fields and shows the empty-tab copy for an empty tab.
- **DP-52 — Inquiry page** `/studio/inquiries/<id>` shows the queue beside the inquiry with a breadcrumb back to its tab, offers only the allowed actions, and after each action closes its panel and updates the pill, history, buttons and counts without a full reload while announcing the change, or shows the refusal where Feedback states places it and leaves the inquiry as it was.
- **DP-53 — Accessibility** Pages meet WCAG 2.2 AA, "Skip to content" is the first focusable element, every control is reachable in a logical order by keyboard, and every focused control shows a visible ring, lilac on the composer.
- **DP-54 — Responsive layout** Every page fits 375x812, 768x1024 and 1280x800 viewports and reflows at 320 CSS pixels without sideways scroll, and on narrow viewports the header links fold into "Menu", which opens a full-screen sheet that "Close" or Escape closes.
- **DP-55 — Motion** Letter reveals, label rises, underline draws, header letter rolls, image zooms, the hero line swap, the cookie card glide, the footer settle and the status-change sequence run with the timings in Motion and effects, and reduced motion shows every end state with the hero line on its first phrase.
- **DP-56 — Palette and grounds** Each page sits on its ground from Visual design, with header text that turns white on dark grounds.
- **DP-57 — Typography** Inter at one regular weight carries every page, hierarchy is size alone on the stated scale, and labels and buttons are small uppercase.
- **DP-58 — Surfaces and covers** Public pages read as a gallery wall of huge type, space and flat colour without shadows or boxes, every cover is a procedural field of its theme colour, and the studio area is dense and compact.
- **DP-59 — Shared status pill** One status pill shows each status with the same colour, dot and word on queue rows, the inquiry page and the status page.
- **DP-60 — Real data, real email and configuration** Inquiries, history, notes, sessions, keys, sign-in attempts, hourly counts and the email outbox live in PostgreSQL, every email leaves over SMTP, and every service address and window length is read from the environment.
- **DP-61 — Sign-in limit** Five failed sign-ins for one email, known or unknown, within the sign-in window and since that email's latest success make every further attempt for it, even with the right password, get the sign-in-limit refusal with `Retry-After`, as qualified in Business rules, while other accounts sign in as normal.
- **DP-62 — Keyboard booking by the associate** Ole Berg can open an inquiry, start review and book its call by keyboard alone, with focus, the field-error attributes, Escape and the live-region copy behaving as Interactions describes, and no lead-only button ever present in the page.
- **DP-63 — Wrong types and unsupported characters** A wrong JSON type in any request field, or an unsupported character in any covered text field, gets the exact answer the Wrong types table or the Messages table gives, changing nothing, sending nothing and never answering 5xx.
- **DP-64 — Private data stays out of email** Every email goes to the inquiry's address alone, and its headers, body and attachments never carry a note, a studio account name or email, an internal id, or another inquiry's reference or token.
- **DP-65 — Resending a studio change** Repeating a successful transition's `Idempotency-Key` from the same account on the same inquiry with an equal body answers 200 with the original response and changes and sends nothing, a different body is refused, and simultaneous identical keyed requests apply once and all answer 200 with one body.
- **DP-66 — Swedish closure days** A call on a Swedish closure day, judged by its Stockholm date, gets the closed-day refusal in the `call_at` check order, and the next studio day at the same time is accepted.
- **DP-67 — Cancellation invitation** A lead's decline from `call_booked` sends its update email with one `intro-call.ics` CANCEL invitation for the cancelled slot under the inquiry's UID, and the sequence keeps rising across decline, reopen and the next booking.

## Frontend

### Screens and layout (DP-01, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-54, DP-58)

Each viewport has its own layout:
- **1280x800:** public pages use a shared side margin and a second column that starts at the page midpoint. Eyebrows, office addresses, paragraphs and the footer email sit in that column. Display type spans the full width.
- **768x1024:** the midpoint column remains for eyebrows and paragraphs, and display type shrinks to fit the width.
- **375x812:** one column, and the header links fold into "Menu". Nothing scrolls sideways at any of these widths or at 320 CSS pixels.

**Header.** On the left is the wordmark, the lowercase word "northpier", linking to `/`. From the midpoint come the links "Work" (to the landing work grid), "Services" and "Start a project", with "Contact" at the far right. They are styled uppercase. The current page's link is underlined. Header text is white on dark grounds and near-black on light ones. On 375 wide the links fold into "Menu", which opens a dark full-screen sheet with the same destinations in large type and a "Close" control.

**Footer**, on every visitor page except the composer and the status page:
- "Let's make something" over "great together" in large type
- the email `hello@northpier.studio` in the same size, as a mail link
- a bottom row with "(c) <year> northpier", where `<year>` is the current year in Stockholm, and the inert labels "Instagram", "X / Twitter" and "LinkedIn"

**Cookie card.** On a first visit a white card appears at the bottom right, on every visitor page. It reads "Hej! We use analytic cookies to measure our website activity.", with a "Privacy policy" link and "Reject" and "Accept" buttons. Either choice is stored for one year in a first-party cookie named `np_consent` holding `accepted` or `rejected`, and the card does not appear while that cookie is set. No analytics load either way.

**Landing** (pale grey ground), from top to bottom:
1. An eyebrow at the midpoint: "Creative partner" over "We craft digital products and brands".
2. The hero: "Design" on the first line; on the next, a grey "&" at the left and "Technology" pushed to the right edge. These stack on 375 wide.
3. A full-width dark media frame with slightly rounded corners holding the glow reel (Motion and effects).
4. The rotating statement: one of "Intelligent products", "Brands with purpose" and "Sites that move", always followed by "from vision to launch".
5. The paragraph "We work closely with our clients to connect business goals with user needs." with a "Services" link.
6. The work grid: all eight cases, two columns on 768 and 1280 wide and one column on 375. Each is a cover over a label (client name, a drawn dash, the industry in grey) and links to its case page.
7. The client index: every client and industry as a large row. While one row is pointed at, the other rows dim.
8. The closing statement: "We believe in well-crafted digital experiences built on strategic foundations, close collaboration and curious technology.", with a "Start a project" link.
9. The footer.

**Case study** (`/work/<slug>`). The whole page is flooded with the case's theme colour. It shows:
- an "Industry" eyebrow over the industry, and an "Awards" eyebrow over the award names when there are any
- the client name filling the width as the title
- a wide frame with the cover
- the headline as a statement that writes itself in
- the two body paragraphs and a pair of smaller frames
- a "Testimonial" eyebrow with the quote and "<name>, <role>"
- "More work" with the two next cases as thumbnail links

**Services** (near-black ground), from top to bottom:
1. The eyebrow "Since 2011" over "Crafting meaningful connections between businesses and people.".
2. The display "Strategy &" over "Craft".
3. An "Approach" eyebrow with two paragraphs.
4. Four service rows, each a grey lead-in, a drawn dash and a white remainder:
   - "Strategy" — "Find the opportunity and the plan to reach it."
   - "Branding" — "Identities that are clear, alive and easy to use."
   - "Design" — "Websites and products people enjoy coming back to."
   - "Development" — "Fast, accessible builds with motion where it matters."
5. Three case thumbnails whose suffix reads "Case".
6. A "Start a project" link.

**Contact** (pale grey ground). "Want to talk?" over the email `hello@northpier.studio` as a link, both in display size. Two office blocks sit at the midpoint:
- "Stockholm", "Hamngatan 41", "111 47 Stockholm, Sweden"
- "Reykjavík", "Laugavegur 27", "101 Reykjavík, Iceland"

Each block ends with a live greeting in grey that updates on each new minute of the browser clock:
- **Stockholm (24-hour time):** "God morgon, klockan är 09:30" before 12:00, "God eftermiddag, klockan är 14:05" from 12:00 until 18:00, and "God kväll, klockan är 21:30" from 18:00.
- **Reykjavík (12-hour time):** "Góðan daginn, klukkan er 9:57 AM", "Góðan dag, klukkan er 2:05 PM" and "Gott kvöld, klukkan er 9:30 PM", on the same boundaries in Reykjavík time.

The times in these examples stand for the current local time in each city. Without scripts, each greeting shows the time at which the server rendered the page. A "Start a project" link follows.

**Privacy policy** (`/privacy-policy`, pale grey ground, with footer). The heading "Privacy policy" in display size, then exactly these four paragraphs in the midpoint column:
1. "When you send an inquiry we store what you tell us: your name, email, company, the services you need, budget, timeline and message. We use it only to answer you and to run your project conversation."
2. "We email you when we receive your inquiry and each time its status changes. Your private status link shows only your own inquiry."
3. "We set one first-party cookie to remember your cookie choice for a year. We load no analytics and no third-party content."
4. "To see, correct or delete what we hold about you, write to hello@northpier.studio." The address is a mail link.

**Start a project** (`/start`, almost-black ground, white text).

At the top is a small white bud mark of four stacked ellipses, with the greeting "Hi, tell us about your project." Below it, three starter cards sit in a row, stacking on 375 wide. Each card is charcoal with a faint edge and a frosted, slightly blurred look, and shows a small grey title over a white line:

| Card title | Line | Selects |
|---|---|---|
| "I have a project" | "A new website or product, from scratch" | Design, Development |
| "Refresh a brand" | "A new identity and a site to match" | Branding, Design |
| "Explore an idea" | "Strategy for something that does not exist yet" | Strategy |

The form sits on a charcoal panel with rounded corners. Its fields:
- "Your name", "Email" and "Company"
- "What do you need?": four toggles, "Strategy", "Branding", "Design", "Development"
- "Budget": a select with the four budget labels
- "Timeline": a select with the four timeline labels
- "Tell us more": a message box with the placeholder "Ask anything..." and a live counter "<n> / 2000", where `<n>` is the message's length counted as Business rules 15 counts it

No field carries a browser length cap that would stop typing or pasting a value the server accepts. The budget and timeline labels are listed under Business rules. Required labels carry an amber asterisk and the hidden word "required". The "Send inquiry" control is a small white disc with an upward arrow in the corner of the message box. Under the form, in small dim type: "We read every inquiry ourselves and reply within two working days." and a "Privacy policy" link.

On success the form is replaced in place by a confirmation:
- "Thanks, <first name>. We have your inquiry."
- "Reference <reference>"
- "Keep this link to follow your inquiry:"
- the full status link in a read-only field, with a "Copy link" button
- an "Open status page" link

`<first name>` is the trimmed name up to its first space.

**Inquiry status** (`/inquiry/<token>`, warm sand ground). From top to bottom:
1. An eyebrow "Your inquiry" over the reference.
2. The current status label in display size, as the page's level 1 heading.
3. The status line for that status (Business rules 1).
4. A summary: submitted date, company when given, services, budget and timeline.
5. The message as literal text with its line breaks kept and no markup interpreted.
6. A dated history list, oldest first.
7. A "Back to the studio" link to `/`.

The page reflects the stored inquiry when it loads. While it is open, it rechecks every 15 seconds. When the status has changed, it replaces the level 1 heading text with the new label and updates the status line and history in place, so a studio change shows within 15 seconds without a reload.

**Studio area** (near-black ground). A compact studio header carries the wordmark, "Inquiries" and "Sign out".

**Sign in** is a centred column with "Studio sign in", "Email", "Password" and a white "Sign in" button.

**Queue** (`/studio`) is titled "Inquiries". It has:
- the tabs "New", "In review", "Call booked", "Won", "Declined" and "All", each with its count
- a search field
- a dense list of rows. Each row shows the reference, name and company, services, budget label, and either the time since it arrived (on New, In review and All) or the call time (on Call booked), plus the status pill. The arrival time is computed when the list loads.

Rows are compact: about twice the body line height each. On 1280 wide the list takes the left third and the right side reads "Choose an inquiry to see it here." On 768 and 375 wide the list fills the page.

**Inquiry page** (`/studio/inquiries/<id>`). On 1280 wide the queue list (tabs, search, rows) stays on the left with the open row highlighted, and the inquiry detail fills the right. On 768 and 375 wide only the detail shows. The detail contains, in order:
1. A breadcrumb "Inquiries / <reference>" whose first part returns to the tab and search it was opened from.
2. The reference and submitted date.
3. The visitor's name in display size.
4. Company, email as a mail link, services, budget, timeline and message.
5. The status block: the status heading (the pill), the call time when set, the action buttons from `allowed_actions`, and their inline panels.
6. "Add a note" with the notes newest first, each with author and time.
7. The history: each change with action, time and who made it.

The panels:
- **"Book call" and "Reschedule call"** open an inline panel with a "Call time" date-and-time field in Stockholm time, on a quarter-hour step. Under the field are two hint lines: "Weekdays 09:00 to 17:00 Stockholm time, on the quarter hour. Calls last 45 minutes." and "Closed on Swedish public holidays and the eves of Midsummer, Christmas and New Year." The panel has a "Confirm" button.
- **"Decline"** opens an inline panel with a required "Reason" select of the four reason labels and a "Confirm decline" button.

The page sends the "Call time" value to the API as Stockholm wall-clock time without an offset, whatever the browser's time zone. Action buttons the caller's role may not use are absent from the page, not merely hidden or disabled.

**Not found** (pale grey ground): "Lost at sea" in display size, "This page does not exist or has moved." and a "Back to the studio" link to `/`.

**Covers** use no assets. Each is drawn in the page from the case's theme colour and `cover_seed`: a field of the theme colour, one large soft white glow and two to four faint dark bands placed by the seed, with the client's initials in the lower left. Nothing is a photograph and nothing loads from elsewhere.

### Public screens and controls (DP-10, DP-39, DP-41, DP-43, DP-44, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-62)

Only these are public. Everything else is up to you. Accessible names and text content read exactly as printed here, whatever case the type is displayed in.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| every page | `link "Skip to content"` | "Skip to content", hidden until focused |
| header | `link "Northpier Studio home"` | wordmark "northpier" |
| header | `navigation "Main"` with `link "Work"`, `link "Services"`, `link "Start a project"`, `link "Contact"`; current page's link has `aria-current="page"` | the four links |
| header, narrow | `button "Menu"` opening `dialog "Menu"` containing the four links and `button "Close"` | "Menu", "Close" |
| visitor pages | `region "Cookie choice"` with `button "Reject"`, `button "Accept"`, `link "Privacy policy"` | cookie copy |
| landing | `heading` level 1 "Design & Technology"; `list "Work"` of eight `link` items named by client; `list "Clients"` | hero, grid, index |
| case page | `heading` level 1 client name; `navigation "More work"` with two links | case copy |
| contact | `status "Stockholm time"`, `status "Reykjavík time"` | the greetings |
| composer | `button "I have a project"`, `button "Refresh a brand"`, `button "Explore an idea"` with `aria-pressed` | card titles and lines |
| composer | `textbox "Your name"`, `textbox "Email"`, `textbox "Company"`, `textbox "Tell us more"` | labels |
| composer | `group "What do you need?"` with `checkbox "Strategy"`, `checkbox "Branding"`, `checkbox "Design"`, `checkbox "Development"` | toggles |
| composer | `combobox "Budget"`, `combobox "Timeline"` | the labels |
| composer | the counter, with text "<n> / 2000" | counter |
| composer | `button "Send inquiry"`; `status "Send status"` | Feedback states copy |
| confirmation | `heading` "Thanks, <first name>. We have your inquiry."; `textbox "Status link"` (read-only); `button "Copy link"`; `link "Open status page"` | confirmation copy |
| status page | `heading` level 1 the status label; `status "Inquiry status"` holding the status line; `list "History"` | status copy |
| sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `status "Sign-in status"` | labels |
| studio header | `link "Inquiries"`, `button "Sign out"` | |
| queue | `tablist "Inquiry tabs"` with `tab` items named "<label> <count>", for example "New 2" | tabs |
| queue | `searchbox "Search name, company, email or reference"` | placeholder of the same words |
| queue | `list "Inquiries"` of `link` rows named "<reference> <name>" | row fields |
| inquiry page | `navigation "Breadcrumb"` | "Inquiries / <reference>" |
| inquiry page | `heading` level 2 named with the status label, in the status block, focusable by script but not in the Tab order | the pill |
| inquiry page | `button "Start review"`, `button "Book call"`, `button "Reschedule call"`, `button "Mark won"`, `button "Decline"`, `button "Reopen"`, present only when allowed | |
| inquiry page | `group "Book call"` or `group "Reschedule call"` with the field labelled "Call time" and `button "Confirm"` | hint copy |
| inquiry page | "Call time" carries `aria-invalid="true"` and `aria-describedby` naming the element holding its message while a `call_at` message shows, and neither otherwise | the message |
| inquiry page | `group "Decline"` with `combobox "Reason"` and `button "Confirm decline"` | reason labels |
| inquiry page | `status "Action status"`; `alert` banner above the actions | Feedback states copy |
| inquiry page | `textbox "Add a note"`, `button "Add note"`, `status "Note status"`, `list "Notes"`, `list "History"` | |
| not found | `heading` level 1 "Lost at sea"; `link "Back to the studio"` | not-found copy |

### Interactions (DP-43, DP-44, DP-49, DP-51, DP-52, DP-53, DP-54, DP-62)

**Pointer, hover and touch**
- Hovering a link draws its underline from the left, and leaving wipes it away to the right.
- Hovering a header link rolls its letters up one after another and replaces them from below.
- Hovering a case cover zooms it a little closer inside its frame.
- Pointing at a client-index row dims the other rows.
- Hovering a starter card brightens its faint edge.
- On touch, a tap does what a click does, and hover effects do not stick.

**Composer**
- Pressing a starter card selects its services and marks it pressed with a lilac edge. Focus moves to the first empty required field.
- The counter updates on every keystroke and paste.
- "Send inquiry" is unavailable until every required field is valid, and again while a send is pending.
- The composer creates one `Idempotency-Key` when the form is first filled. It reuses that key for every send of the form until a send succeeds.
- Without scripts, the form posts as a normal form to `/start` with that key in a hidden field. The server answers with the confirmation page, or with the form refilled and the messages shown.
- "Copy link" copies the status link to the clipboard.

**Menu**
- "Menu" opens the sheet and moves focus to its first link.
- "Close" or Escape closes it and returns focus to "Menu".
- Tab cycles within the sheet while it is open.

**Queue search and the address**
- Typing in the search narrows the current tab's list and updates every tab count within one second of the last keystroke.
- The tab and `q` are written into the address as ordinary query parameters without a reload. Each settled search and each tab change adds one history entry.
- Selecting a tab keeps `q`.
- Opening an inquiry carries the list's `status` and `q` into the inquiry page's address.
- Back and Forward restore the tab, the search field's text, the narrowed list and the open inquiry that the address names.
- Tab reaches each row link, and Enter opens it.

**Inquiry actions**
- An action button opens its panel and moves focus to the panel's first field. Actions with no input apply at once.
- Escape inside an open panel closes it and returns focus to its button. Reopening the panel shows an empty field with no message and no invalid mark.
- Enter in "Call time" confirms.
- The page creates one `Idempotency-Key` for each opened action and reuses it if that same request is retried.
- After a refused call time, focus stays in "Call time", the message shows under it and the field is marked invalid as the controls table states.
- After a success:
  - the panel closes
  - the pill, call time, history, buttons and counts update without a full reload
  - focus moves to the status heading
  - if the inquiry has left the current tab, its row leaves the list
- After a refusal without a field, the page shows the inquiry exactly as it was before the action and focus returns to the action's button.

**Keyboard order**
- On every page, Tab order is "Skip to content", the header controls in reading order, then the page content in reading order.
- On the inquiry page the order is breadcrumb, actions, panel, notes, history.

### Visual design (DP-53, DP-56, DP-57, DP-58, DP-59)

**Colour roles, in words**
- Public pages: a pale, faintly cool grey ground with near-black ink.
- Services and studio pages: near-black ground with white text.
- Composer: an almost-black room with deep charcoal fields, a soft blue lilac for focus rings and pressed cards, and a warm yellow-amber for required marks and field messages.
- Status page: warm sand, with a light warm brown for secondary text.
- Light neutral grey for eyebrows and the hero ampersand, and a mid grey for lead-ins on dark.
- Case grounds by theme: `orange` a warm orange, `violet` a light vivid indigo violet, `lemon` acid lemon, `clay` a light warm clay, `sand` sand, `ink` near-black, `mist` pale grey.
- Status pills show a thin coloured edge and dot beside the word: lilac `new`, amber `in_review`, orange `call_booked`, lemon `won`, grey `declined`.
- Exact shades are yours, provided every text and control meets WCAG 2.2 AA contrast on its ground.

**Type.** Inter, falling back to the system sans, at one regular weight, with italic for emphasis. Hierarchy is size alone, on a scale where each step is about one third larger than the one below:
- Body is the base.
- Uppercase labels and buttons are one step below body. Uppercase is a display style only: the underlying text keeps the capitalisation printed in this brief.
- Statements are three steps above body.
- Page display type is five steps above body.
- The hero is about nine times body on 1280 wide and about five times body on 375.

Display type and covers reserve their space, so nothing shifts as they load.

**Density and composition**
- Public pages are airy: wide margins, generous gaps between sections, and no shadows, cards or boxed panels. Only space, huge type and one flat colour at a time.
- The composer is close and quiet: one dark panel, small dim helper text, no decoration.
- The studio list is dense, with compact rows beside the detail.

**Controls.** Every button, toggle, tab and link row is at least 44 px tall and wide. Every focused control shows a visible ring: lilac on the composer, white on dark studio pages and near-black on light pages. Status is always given in words as well as colour.

### Motion and effects (DP-55)

**One timing and one deceleration.** Every movement starts quickly and settles softly. Colour changes, rises and fades take 0.45 seconds. The image zoom takes one second. Nothing loops unless it is named here.

**Effects by meaning**
- **Statement enter.** Big statements and the not-found heading assemble letter by letter as they enter view. Each letter settles upright from a slight lean and fades in over 0.45 seconds. Letters start 12 milliseconds apart in reading order. This runs once per page view.
- **Label enter.** Eyebrows, list items and history items fade in and rise a short way from below over 0.45 seconds. Siblings start 60 milliseconds apart. This runs once.
- **Link hover.** The underline draws on over 0.45 seconds and wipes off to the right over 0.45 seconds. Each plays once and holds its end state.
- **Header hover.** Each letter rolls up over 0.45 seconds and is replaced from below, starting 12 milliseconds after the previous letter.
- **Cover hover.** The cover zooms a little closer over one second, and returns over one second when the pointer leaves.
- **Hero line.** The rotating phrase swaps every 3 seconds, the old phrase rising out and the new one rising in over 0.45 seconds.
- **Glow reel.** The landing media frame holds a slow drifting white glow on near-black. It completes one drift every 20 seconds, and it is the only continuous loop.
- **Cookie card.** It glides in from the right over 0.45 seconds, one second after the page loads.
- **Footer settle.** As the footer scrolls into view, its email and links rise from below and go from partly see-through to solid, in step with the scroll. They rest once the footer is fully in view and reverse step by step when the user scrolls back up.
- **Menu sheet.** It fades in over 0.45 seconds and fades out over 0.45 seconds.
- **Press feedback.** Buttons darken or lighten over 0.45 seconds on press and hover.

**Signature: the pipeline moves in step.** After a studio action succeeds, the inquiry page plays these steps:
1. The open panel folds closed over 0.45 seconds.
2. The pill's colour, dot and word cross-fade to the new status over 0.45 seconds.
3. The new history entry rises into the bottom of the history list over 0.45 seconds.
4. Each changed tab count changes its number with a 0.45-second fade.
5. The row leaves the current tab's list by fading and closing its gap over 0.45 seconds, if it no longer belongs there.

The whole sequence ends within one second. When the visitor's status page picks up the change, its status label reassembles letter by letter as a statement enter, and its line fades in. A refused call time moves nothing: the pill stays, and the message appears under "Call time" while the field's edge turns amber.

**Reduced motion.** When the user prefers reduced motion:
- Every reveal shows its end state at once, with no letter reveals, rises, rolls or zooms.
- Colour changes are instant.
- The hero line stays on its first phrase, "Intelligent products".
- The glow reel shows one still frame.
- The footer and cookie card appear in place.
- The signature sequence shows its end state at once.

### Feedback states (DP-12, DP-43, DP-49, DP-50, DP-52, DP-61)

Field messages, refusal copy and the outage copy are the Messages table entries in API. This section says where they appear and which region announces them.

| Async action | Pending | Success | Field error | Refusal without a field, or outage |
|---|---|---|---|---|
| Send inquiry | "Send status" reads "Sending your inquiry..."; send control unavailable | form replaced by the confirmation; "Send status" reads "Inquiry sent." | message under its field in amber, focus on that field, "Send status" reads "Check the highlighted field."; everything typed is kept | the message in "Send status"; everything typed is kept |
| Copy link | none | "Send status" reads "Link copied." | none | "Send status" reads "Copy the link from the field above." |
| Sign in | "Sign-in status" reads "Signing in..." | navigation to the landing page of DP-10 | the sign-in message, including the sign-in-limit message, under the button in amber and also in "Sign-in status" | the message in "Sign-in status" |
| Studio action | "Action status" reads "Saving..."; action buttons unavailable | "Action status" reads "Status changed to <label>." or, after a reschedule, "Call moved to <call time>." | a `call_at` message under "Call time"; a `decline_reason` message under "Reason" | the message in the `alert` banner above the actions; the inquiry stays as it was |
| Add note | "Note status" reads "Adding note..." | note appears at the top of "Notes"; "Note status" reads "Note added." | message under "Add a note" | the message in "Note status" |
| Queue search and tabs | the list keeps its old rows until the new ones arrive | rows and counts replaced | the `q` message above the list; rows and counts stay as they were | "Nothing here right now." stays hidden; the outage message appears above the list |
| Status page recheck | none | label, line and history updated | none | the page keeps what it shows and retries at the next recheck |

An empty tab reads "Nothing here right now." `<label>` and `<call time>` are defined in Business rules 1. Success copy says the change is saved, never that an email has arrived.

## Backend

### API (DP-06, DP-07, DP-09, DP-11, DP-12, DP-14, DP-18, DP-19, DP-34, DP-35, DP-37, DP-38, DP-61, DP-63, DP-65)

All API bodies are JSON (`application/json; charset=utf-8`). `POST` bodies must be JSON objects of at most 65,536 bytes. Exactly 65,536 bytes is allowed. Studio endpoints and `GET /api/me` need `Authorization: Bearer <token>` or the studio session cookie that the sign-in page sets. No other endpoint needs authentication.

| Endpoint | Request | Success |
|---|---|---|
| `GET /api/health` | none | as stated in Deployment |
| `POST /api/auth/login` | `{email, password}` | `200 {token, user}` |
| `POST /api/auth/logout` | none, signed in | `204`, the token stops working |
| `GET /api/me` | none, signed in | `200 user` |
| `GET /api/cases` | none | `200` array of `{slug, client, industry, theme, position}` in position order |
| `GET /api/cases/{slug}` | none | `200` one case plus `more`, the next two cases in position order, wrapping around |
| `POST /api/inquiries` | `{name, email, company, services, budget, timeline, message}`; optional header `Idempotency-Key` | `201 {reference, status, status_token, status_url}`; a replay answers `200` with the identical body |
| `GET /api/inquiries/status/{token}` | none | `200` public inquiry |
| `GET /api/studio/inquiries` | query `status` (`new` default, `in_review`, `call_booked`, `won`, `declined` or `all`), `q` optional | `200 {inquiries, counts}` |
| `GET /api/studio/inquiries/{id}` | none | `200` studio inquiry plus `allowed_actions`, `history`, `notes` |
| `POST /api/studio/inquiries/{id}/transition` | `{action, version, call_at, decline_reason}`; optional header `Idempotency-Key` | `200` studio inquiry plus `allowed_actions`, `history`; a replay answers `200` with the stored original body |
| `POST /api/studio/inquiries/{id}/notes` | `{body}` | `201 {id, body, author_name, created_at}` |

An `{id}` that is not a stored inquiry's id, including any non-numeric or out-of-range value, is unknown.

**Shapes**
- **`user`:** `{id, name, email, role}`, where `role` is `lead` or `associate`.
- **Case:** `{slug, client, industry, theme, position, headline, body, awards, testimonial}`. `body` is an array of two paragraphs, `awards` an array of names, and `testimonial` is `{quote, name, role}`.
- **Studio inquiry:** `{id, reference, name, email, company, services, budget, timeline, message, status, call_at, decline_reason, version, created_at, updated_at}`. Queue rows carry the same fields except `message`. Neither ever carries `status_token`.
- **`counts`:** `{new, in_review, call_booked, won, declined, all}`.
- **`allowed_actions`:** an array of action names in Transitions table order.
- **Studio history item:** `{action, from_status, to_status, call_at, decline_reason, actor_name, created_at}`, oldest first. For the submission, `action`, `from_status` and `actor_name` are `null`.
- **Note:** `{id, body, author_name, created_at}`, newest first.
- **Public inquiry:** `{reference, status, call_at, decline_reason, company, services, budget, timeline, message, created_at, history}`, where each history item is `{status, created_at}`, oldest first. It never includes a name, email, note, actor, id or token.
- **Values:** `services` is an array of service values. `call_at` and every timestamp are ISO 8601 UTC instants ending in `Z`, with `call_at` written to the second, for example `2026-11-02T09:00:00Z`.
- **`status_url`:** `APP_PUBLIC_URL` followed by `/inquiry/<token>`.

**Error shape.** Every refusal is `{"error": {"field": <field name or null>, "message": <message>}}`. The one exception is `GET /api/health`, which always answers with the bodies stated in Deployment, including its 503, and never with this shape. Unknown API paths answer `404` in this shape. Unknown page addresses answer the HTML not-found page with status 404.

**Refusal order** (one rule for the whole API). A request is checked in this order, and the first failing check answers:
1. A method other than `GET` or `HEAD` on a status address, either the API address `/api/inquiries/status/{token}` or the page `/inquiry/<token>` (405). This check comes before the token lookup and before any body check, so the answer is 405 whatever the token, body size or body content.
2. Body over 65,536 bytes (413).
3. Missing or invalid sign-in where one is needed (401).
4. Unknown inquiry id, status token, case slug or path (404).
5. Body that is not a JSON object, or a malformed `Idempotency-Key` (400).
6. Forbidden: a cookie-authenticated write from another origin, or a lead-only action from an associate (403).
7. On sign-in only: the sign-in limit (429), then wrong credentials (401). The limit is judged before the password.
8. A matching `Idempotency-Key`: a replay answers 200 with its stored response, and a mismatch answers 409. A request that finds a simultaneous identical keyed request in progress waits for it and then answers as its replay.
9. Stale, missing or wrong-typed version (412).
10. State conflicts: action not allowed from the status, call not yet held, reopen window closed (409).
11. Field validation (422), reporting only the first failing field. For an inquiry, fields are checked in form order: name, email, company, services, budget, timeline, message. For the queue, `status` comes before `q`. Within each text field, the unsupported-character check comes first. For `call_at`, the checks run in the order of the `call_at` rows of the Messages table.
12. Call overlap (409).
13. The hourly inquiry limit (429).

**Messages** (every refusal and its exact status, field and message):

| Situation | Status | Field | Message |
|---|---|---|---|
| body over 65,536 bytes | 413 | `null` | "Request body is too large." |
| no, unknown or ended token on a studio endpoint or `GET /api/me` | 401 | `null` | "Sign in to continue." |
| unknown inquiry, status token, case slug or API path | 404 | `null` | "Not found" |
| any method other than `GET` or `HEAD` on a status address, API or page | 405 | `null` | "Method not allowed" |
| body not valid UTF-8 JSON, not a JSON object, or nested more than 32 levels deep, on any `POST` endpoint | 400 | `null` | "Invalid request body" |
| `Idempotency-Key` not 8 to 64 characters of letters, digits, `-` or `_`, on either endpoint that takes one | 400 | `null` | "Idempotency-Key must be 8 to 64 letters, digits, - or _." |
| cookie-authenticated `POST` whose `Origin` names another origin | 403 | `null` | "Cross-origin request refused." |
| associate sends `mark_won`, `decline` or `reopen` | 403 | `action` | "Only a studio lead can do this." |
| sign-in limit reached for that email | 429 | `email` | "Too many sign-in attempts. Try again later." |
| wrong email or password at sign in, including an unknown email | 401 | `email` | "Incorrect email or password." |
| inquiry `Idempotency-Key` already used with a different body | 409 | `null` | "This key was already used for a different inquiry." |
| transition `Idempotency-Key` already used by that account on that inquiry with a different body | 409 | `null` | "This key was already used for a different change." |
| stale, missing or wrong-typed version | 412 | `version` | "This inquiry changed since you opened it. Reload to see the latest." |
| action unknown, not a string, or not allowed from the current status | 409 | `action` | "This action is not allowed from the current status." |
| `mark_won` before the call start has passed | 409 | `action` | "Mark won after the intro call has taken place." |
| `reopen` once the reopen window has closed | 409 | `action` | "This inquiry can no longer be reopened." |
| a covered text field holding an unsupported character | 422 | that field | "Remove the unsupported characters." |
| blank name | 422 | `name` | "Name is required." |
| name over 80 characters | 422 | `name` | "Name must be 80 characters or fewer." |
| malformed email | 422 | `email` | "Enter a valid email address." |
| company over 120 characters | 422 | `company` | "Company must be 120 characters or fewer." |
| no service, or an unknown one | 422 | `services` | "Choose at least one service." |
| missing or unknown budget | 422 | `budget` | "Choose a budget." |
| missing or unknown timeline | 422 | `timeline` | "Choose a timeline." |
| message under 20 characters | 422 | `message` | "Tell us a little more: at least 20 characters." |
| message over 2000 characters | 422 | `message` | "Message must be 2000 characters or fewer." |
| call time missing, unreadable or not in the future | 422 | `call_at` | "Choose a call time in the future." |
| call time more than 90 days ahead | 422 | `call_at` | "Choose a call time within the next 90 days." |
| call outside studio hours | 422 | `call_at` | "Calls are booked on weekdays between 09:00 and 17:00 Stockholm time." |
| call on a studio closure day | 422 | `call_at` | "The studio is closed that day." |
| call not on a quarter hour | 422 | `call_at` | "Choose a time on a quarter hour." |
| decline without a valid reason | 422 | `decline_reason` | "Choose a reason." |
| blank note | 422 | `body` | "Note cannot be empty." |
| note over 1000 characters | 422 | `body` | "Note must be 1000 characters or fewer." |
| unknown queue tab | 422 | `status` | "Unknown tab." |
| search over 100 characters | 422 | `q` | "Search must be 100 characters or fewer." |
| call overlaps another booked call | 409 | `call_at` | "That time overlaps another booked call." |
| sixth inquiry from one email within the inquiry window | 429 | `email` | "Too many inquiries from this email. Try again in an hour." |
| PostgreSQL unreachable, on any API endpoint except `GET /api/health` | 503 | `null` | "The studio desk is unavailable. Try again shortly." |

A 429 also carries `Retry-After` in whole seconds, as Business rules 19 and 20 compute it. A 405 carries `Allow: GET, HEAD`. The sign-in refusal for an unknown email and for a wrong password are identical byte for byte, headers aside.

**Wrong types.** A field of the wrong JSON type answers as listed here, and is never coerced. Equal-looking values of other types do not pass: `true`, `1.0` and `"2"` are not integers.

| Field | Wrong type | Answers as |
|---|---|---|
| transition `version` | anything other than a JSON integer, including `true`, `false`, a number with a fraction or exponent, a string, `null` or absent; an integer of any size that is not the current version is simply stale | the stale-version row (412) |
| transition `action` | anything other than a string | the not-allowed row (409) |
| transition `call_at`, when the action needs it | anything other than a string | the "call time missing" row |
| transition `decline_reason`, on `decline` | anything other than a string | the decline-reason row |
| inquiry `name` | anything other than a string | the blank-name row |
| inquiry `email` | anything other than a string | the malformed-email row |
| inquiry `company` | anything other than a string, absent or `null` (absent and `null` mean no company) | the company row |
| inquiry `services` | anything other than an array of strings | the services row |
| inquiry `budget`, `timeline` | anything other than a string | the budget row or the timeline row |
| inquiry `message` | anything other than a string | the message-under-20 row |
| note `body` | anything other than a string | the blank-note row |
| sign-in `email` or `password` | absent or anything other than a string | the wrong-credentials row (401), counted toward no email's sign-in limit |

Fields an action does not use are ignored whatever their type.

### Business rules (DP-07, DP-11, DP-13, DP-14, DP-15, DP-17, DP-20, DP-21, DP-22, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-35, DP-36, DP-37, DP-61, DP-63, DP-64, DP-65, DP-66, DP-67)

**1. Labels.**

| Status | Label | Status line |
|---|---|---|
| `new` | "New" | "We have your inquiry and will look at it shortly." |
| `in_review` | "In review" | "We are reading through your project and may get in touch with questions." |
| `call_booked` | "Call booked" | "Your intro call is booked for <call time> Stockholm time." |
| `won` | "Won" | "We are starting together. We will be in touch with next steps." |
| `declined` | "Declined" | "We are not the right fit this time: <reason label>. Thank you for thinking of us." |

- `<call time>` is the call's Stockholm wall-clock time written as `<weekday> <day> <month>, <HH:mm>`. It uses English weekday and month names, the day without a leading zero and 24-hour time, for example `Thursday 5 November, 14:00`.
- Reasons: `outside_services` "Outside our services", `timeline` "Timeline does not fit", `budget` "Budget does not fit", `fully_booked` "Fully booked".
- Services: `strategy` "Strategy", `branding` "Branding", `design` "Design", `development` "Development".
- Budgets: `under_25k` "Under 25k EUR", `25k_75k` "25k to 75k EUR", `75k_150k` "75k to 150k EUR", `over_150k` "Over 150k EUR".
- Timelines: `asap` "As soon as possible", `within_3_months` "Within 3 months", `3_to_6_months` "In 3 to 6 months", `exploring` "Just exploring".

**2. Transitions.** This is the whole pipeline.

| action | from | to | who | extra input and precondition |
|---|---|---|---|---|
| `start_review` | `new` | `in_review` | lead, associate | none |
| `book_call` | `in_review` | `call_booked` | lead, associate | `call_at` (rules 7 to 12) |
| `reschedule_call` | `call_booked` | `call_booked` | lead, associate | `call_at` (rules 7 to 12) |
| `mark_won` | `call_booked` | `won` | lead | the stored call start is in the past (rule 13) |
| `decline` | `new`, `in_review`, `call_booked` | `declined` | lead | `decline_reason` |
| `reopen` | `declined` | `in_review` | lead | less than the reopen window since the latest decline (rule 14) |

- `won` is final. Every other action, from any status, is refused with the not-allowed refusal.
- `decline` clears nothing but frees the call slot, because only `call_booked` inquiries hold slots.
- `reopen` clears `call_at` and `decline_reason`.
- No action rewrites the submitted fields.

**3. Roles.** The Transitions table's "who" column is the authority. An associate sending a lead-only action receives the lead-only refusal, whatever the inquiry's status. `allowed_actions` lists the actions whose "from" includes the current status and whose "who" includes the caller's role. It does not consider the call time or the reopen window, which the server judges when the action arrives. A role is set only by the seed, and no request changes it.

**4. Versions and simultaneous changes.**
- Every inquiry starts at `version` 1. Each successful transition, including a reschedule, raises it by exactly one and writes exactly one history entry, with the action, the new status, the call time or reason, the acting account and the time.
- A transition must name the version it was based on. A different, missing or wrong-typed version gets the stale-version refusal.
- When unkeyed transitions for one inquiry at the same version arrive together, exactly one succeeds. The others get the stale-version refusal and write nothing.

**5. Resending a studio change.**
- A transition may carry an `Idempotency-Key` header in the format of rule 18. A key is scoped to the signed-in account, the inquiry and the key value, so the same value from another account or on another inquiry is a fresh key.
- The key is remembered, with its request body and response body, only when the transition succeeds. A refused transition leaves the key unused.
- The same key with an equal JSON body within `NP_IDEMPOTENCY_TTL_SECONDS` answers 200 with the stored original response body. This holds even though that body's `version` is now stale and even after later transitions. It writes nothing and sends nothing. Bodies are equal when they parse to equal JSON values.
- The same key with a different body within that time gets the change-key conflict refusal.
- When identical keyed transitions arrive together, exactly one applies, writing one history entry and one email. Every other request answers 200 with the identical body, and none gets 412.
- Without a key, rule 4 applies.

**6. History** is append-only. The submission writes the first entry. Reopen adds an entry and never removes the decline.

**7. Call window.** `call_at` must be later than now and no more than 90 days (90 × 24 hours) after now. Exactly 90 days ahead is allowed.

**8. Studio hours in Stockholm time.**
- A call lasts 45 minutes.
- Read in Europe/Stockholm local time, using the IANA rules for that date, a call must fall Monday to Friday, start at or after 09:00 and end at or before 17:00. The latest start is therefore 16:15.
- The server judges this. It never uses UTC or the browser's zone as local time.

**9. Closure days and studio days.**
- The studio is closed on these Stockholm dates: 1 January, 6 January, Good Friday (two days before Easter Sunday), Easter Monday (the day after Easter Sunday), 1 May, Ascension Day (39 days after Easter Sunday), 6 June, Midsummer Eve (the Friday from 19 to 25 June), and 24, 25, 26 and 31 December. Easter Sunday is the Western (Gregorian) Easter of that year.
- A call whose Stockholm date is a closure day gets the closed-day refusal. A weekend or out-of-hours time gets the hours refusal instead, because the hours check runs first.
- A studio day is a Monday to Friday that is not a closure day.

**10. Quarter hours.** In Stockholm time the start minute must be 00, 15, 30 or 45, with zero seconds.

**11. One calendar.**
- No two inquiries in `call_booked` may have calls that overlap. A call starting exactly when another ends is allowed.
- A reschedule ignores the inquiry's own current slot.
- When bookings or reschedules for overlapping slots on different inquiries arrive together, exactly one succeeds, and the others get the overlap refusal and write nothing.

**12. Stockholm wall-clock rule.**
- A `call_at` with `Z` or an explicit offset is that instant.
- A `call_at` without an offset (`YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`) is a Stockholm wall-clock time. It is converted with the offset Stockholm uses on that date: one hour ahead of UTC in winter, two in summer. For example, 10:00 Stockholm is stored as 09:00 UTC on a winter date and 08:00 UTC on a summer date.
- Moving a call across a daylight-saving change keeps the typed wall-clock time and stores the new instant.
- Wall-clock times that a clock change skips or repeats fall early on a Sunday, so they always get the hours refusal.
- The stored value is always the UTC instant.

**13. Won after the call.** `mark_won` needs the stored `call_at` to be strictly before now.

**14. Reopen window.**
- `reopen` is accepted while the time since the inquiry's latest decline history entry is less than `NP_REOPEN_WINDOW_SECONDS`, which defaults to 2,592,000 seconds (30 days).
- At exactly the window length, or later, it gets the window-closed refusal.
- The window counts from the decline entry, not from `updated_at`.

**15. Text and characters.**
- Every length limit counts Unicode code points, after trimming leading and trailing whitespace and after turning each carriage return and line feed pair into a single line feed. So an emoji written as one code point counts as one character, a combined emoji counts each of its code points, and a line break counts as one. The composer counter counts the same way.
- The covered text fields are inquiry `name`, `email`, `company` and `message`, note `body`, and queue `q`.
- In a covered field, an unsupported character gets the unsupported-character refusal for that field. Unsupported characters are U+0000 to U+001F, U+007F, and any unpaired surrogate escape. Tab, line feed and carriage return are allowed in `message` and note `body` only.
- This check runs on the value as sent, before trimming.

**16. Sending an inquiry.**
- Required: a name of 1 to 80 characters, a valid email of up to 254 characters (stored lowercase), at least one known service, a budget, a timeline, and a message of 20 to 2000 characters. The limits are inclusive.
- A valid email has no whitespace, exactly one `@`, a non-empty part before it, and a part after it that contains a dot with characters on both sides.
- Company is optional, up to 120 characters.
- The server mints the reference and status token. A new inquiry is `new` at version 1.

**17. Server-owned fields.** The server ignores any `reference`, `status_token`, `status`, `version` (except as the transition precondition), `role`, `id`, `author_id`, `actor_id`, `author_name`, `actor_name` or `created_at` in any request body. Unknown body fields are ignored.

**18. Resending an inquiry.**
- `POST /api/inquiries` may carry an `Idempotency-Key` header, or a hidden form field of the same value on the no-script form. A key is 8 to 64 characters of letters, digits, `-` or `_`.
- The key is remembered only when the request stores an inquiry. A refused request leaves the key unused.
- The same key with an identical JSON body within `NP_IDEMPOTENCY_TTL_SECONDS` (default 86,400 seconds, 24 hours) of the first use answers 200 with the identical original body. It stores nothing, sends nothing and does not count toward the hourly limit.
- Bodies are identical when they parse to equal JSON values. Key order and whitespace do not matter.
- The same key with a different body within that time gets the inquiry-key conflict refusal.
- After that time the key is forgotten and treated as new.
- When identical keyed requests arrive together, exactly one answers 201 and creates the inquiry and its one email. Every other request answers 200 with that same body.

**19. Five inquiries an hour.** One email address, compared lowercase, may have at most five stored inquiries created within the last `NP_FLOOD_WINDOW_SECONDS` (default 3,600 seconds), called the inquiry window. A sixth valid inquiry gets the hourly-limit refusal and stores and sends nothing. Replays never count. The refusal's `Retry-After` is the number of seconds until the oldest counted inquiry leaves the window, rounded up, and at least 1.

**20. Sign-in limit.**
- Every sign-in attempt whose email is a string is recorded with the trimmed, lowercased email and whether it succeeded. Seeded and unknown emails are treated alike.
- A counted failure for an email is a failed attempt within the last `NP_SIGNIN_WINDOW_SECONDS` (default 900 seconds) that came after that email's latest successful sign-in.
- While an email has five or more counted failures, every attempt for it gets the sign-in-limit refusal, including one with the right password. The password is not checked and no session is created.
- A refused-by-limit attempt is not recorded as a failure, so it never extends the lockout.
- `Retry-After` is the number of seconds until enough counted failures leave the window to bring the count below five, rounded up, and at least 1.
- Other emails are unaffected.

**21. Queue.**
- `q` is trimmed. When it is not empty, it narrows the list to inquiries whose name, company, reference or email local part (the part before `@`) contains it, ignoring case.
- `q` is matched literally: `%`, `_` and `\` match only themselves.
- `q` may be at most 100 characters after trimming. Exactly 100 is allowed.
- `counts` are computed over the same narrowed set for every status, so each count equals the length of that tab's list, and `all` equals the sum of the five.
- Orders: `new` and `in_review` oldest submitted first; `call_booked` soonest `call_at` first; `won` and `declined` most recent `updated_at` first; `all` newest submitted first.

**22. Notes** come from either role. Each is 1 to 1000 characters, append-only, newest first, and never changes status, version or `updated_at`.

**23. Private status.** The status token is the only signed-out way to read an inquiry, and the status address only reads.

**24. Formats.**
- A reference is `NP-` followed by six characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, unique.
- A status token is unique. A token minted for a new inquiry is at least 22 URL-safe random characters. A seeded inquiry's token is the fixture value Seed data gives.
- A sign-in token is at least 32 URL-safe random characters, stored only as a hash, and valid until sign-out.

**25. Emails.**
- Every email goes over SMTP from `Northpier Studio <hello@northpier.studio>` with exactly one `To`, the inquiry's own address. There is no `Cc` or `Bcc`, and any `Reply-To` is `hello@northpier.studio`.
- The body is one plain-text UTF-8 part. Lines may end in LF or CRLF, and one trailing line break is allowed.
- No header, body or attachment ever contains a note's text, a studio account's name or email, an inquiry's numeric id or any studio address, or any inquiry's reference or token other than this inquiry's own.

| When | Subject, exactly | Body, exactly | Attachment |
|---|---|---|---|
| an inquiry is stored | `We have your inquiry <reference>` | `Hi <name>,`, a blank line, `We have your inquiry <reference>.`, a blank line, `Follow your inquiry: <status link>` | none |
| each successful transition | `Your inquiry <reference> is now <label>` | the status line for the new status, a blank line, `Follow your inquiry: <status link>` | as rule 26 states |

`<name>` is the visitor's trimmed name and `<status link>` is the inquiry's `status_url`. Notes, refusals, replays and seeding send nothing.

**26. Calendar invitations.**
- `book_call` and `reschedule_call` emails carry one REQUEST invitation. A `decline` from `call_booked` carries one CANCEL invitation for the slot it frees. Every other email carries no calendar part.
- The invitation is one attachment named `intro-call.ics` with content type `text/calendar; method=REQUEST; charset=UTF-8` or `text/calendar; method=CANCEL; charset=UTF-8`.
- It holds one `VCALENDAR` with `VERSION:2.0`, `PRODID:-//Northpier Studio//Inquiry desk//EN`, `METHOD:REQUEST` or `METHOD:CANCEL`, and one `VEVENT` with exactly these properties:
  - `UID:<reference>@northpier.studio`, the same for every invitation of the inquiry
  - `SEQUENCE:<n>`, where `<n>` is the number of earlier history entries of this inquiry that are a `book_call`, a `reschedule_call`, or a `decline` from `call_booked`. For example, book, reschedule, decline, reopen, book give 0, 1, 2 (CANCEL), then no invitation, then 3.
  - `DTSTAMP`, `DTSTART` and `DTEND` as UTC values in the form `YYYYMMDDTHHMMSSZ`, with `DTEND` 45 minutes after `DTSTART`. For a CANCEL they are the cancelled slot's times.
  - `SUMMARY:Northpier intro call <reference>`
  - `ORGANIZER:mailto:hello@northpier.studio`
  - `ATTENDEE:mailto:<inquiry email>`
  - `STATUS:CONFIRMED` on a REQUEST and `STATUS:CANCELLED` on a CANCEL
- Every line ends in CRLF. A line longer than 75 octets is folded with CRLF followed by one space.

**Tables.** All timestamps are stored in UTC.
- `studio_users`: `id`, `name`, `email` (unique, lowercase), `role` (`lead` or `associate`), `password_hash`, `created_at`.
- `sessions`: `id`, `user_id`, `token_hash`, `created_at`, `ended_at`.
- `sign_in_attempts`: `id`, `email`, `succeeded`, `created_at`.
- `cases`: `slug`, `client`, `industry`, `theme`, `headline`, `body`, `awards`, `testimonial_quote`, `testimonial_name`, `testimonial_role`, `cover_seed`, `position` (1 to 8). Read-only.
- `inquiries`: the studio inquiry fields plus `status_token`.
- `status_events`: `id`, `inquiry_id`, `action`, `from_status`, `to_status`, `call_at`, `decline_reason`, `actor_id`, `created_at`. Append-only.
- `notes`: `id`, `inquiry_id`, `author_id`, `body`, `created_at`. Append-only.
- `idempotency_keys`: `key`, `request_body`, `response_body`, `inquiry_id`, `created_at`.
- `transition_keys`: `user_id`, `inquiry_id`, `key`, `request_body`, `response_body`, `created_at`.
- `outbox`: `id`, `inquiry_id`, `to_address`, `subject`, `body`, `calendar`, `created_at`, `sent_at`, `attempts`.

### Services (DP-04, DP-16, DP-17, DP-60, DP-64, DP-67)

- **PostgreSQL** at `DATABASE_URL` holds every record in the tables above. The app connects as a non-superuser owner and applies its schema idempotently on every start.
  - If PostgreSQL is unreachable while serving, every API request except `GET /api/health` answers the 503 refusal from the Messages table, and `GET /api/health` answers as Deployment states. Pages show that message in place of their content, with HTTP status 503.
- **Mailpit** receives every email over SMTP at `SMTP_HOST`:`SMTP_PORT`, without authentication.
  - Each email is written to the outbox in the same database transaction as the change that causes it, then sent. When the SMTP server is reachable, each email arrives in Mailpit within 10 seconds of the response.
  - When the SMTP server is unreachable or refuses the connection, the request still succeeds. Sending is retried at least every 10 seconds, and each pending email arrives within 20 seconds of the SMTP server becoming reachable again.
  - Delivery is at least once. An outbox row is marked sent only after SMTP accepts the email and that mark is committed, and a row marked sent is never sent again.
  - Only one sender works on an outbox row at a time, so simultaneous senders, retries and requests never send one row in parallel. When every send ends with a clear answer from the SMTP server and the sent mark is committed, each email arrives exactly once.
  - When the outcome of a send is uncertain, the row stays unsent and is sent again. This covers an SMTP acceptance whose acknowledgement is lost, PostgreSQL becoming unavailable before the sent mark is committed, and the app stopping mid-send. Such an email may therefore arrive more than once.
  - Every send of one outbox row carries the same `Message-ID` header, `<<reference>.<n>@northpier.studio>`, where `<n>` is the number of earlier outbox rows of the same inquiry, so a repeated delivery is recognisable as the same email.
  - Emails for one inquiry are delivered in the order of its changes.

### Seed data (DP-02, DP-03, DP-07, DP-38)

The app seeds on first start, into an empty database, and never duplicates rows on restart. Times are relative to that first start. "Stockholm date" is the calendar date in Stockholm at first start. Studio days follow Business rules 9. Every seeded person and business is invented.

**Studio accounts.** Every account uses the password `deku-demo-pw-2026`. It is fixture data: hash it as normal.

| Name | Email | Role |
|---|---|---|
| Sana Holm | `sana@example.com` | `lead` |
| Ole Berg | `ole@example.com` | `associate` |

**Cases**, in position order. Each has its own invented headline, two body paragraphs and testimonial with name and role, plus a `cover_seed` integer.

| Position | Slug | Client | Industry | Theme | Awards |
|---|---|---|---|---|---|
| 1 | `maison-vey` | Maison Vey | Luxury | `ink` | Site of the Day, Developer Award |
| 2 | `halden-labs` | Halden Labs | AI Technologies | `orange` | none |
| 3 | `kvarn-group` | Kvarn Group | Business Solutions | `clay` | none |
| 4 | `ostra-health` | Ostra Health | Health Tech | `violet` | none |
| 5 | `lumen-bio` | Lumen Bio | Bio Tech | `lemon` | none |
| 6 | `sola-rooms` | Sola Rooms | Hospitality | `sand` | none |
| 7 | `fjell-energy` | Fjell Energy | Sustainability | `mist` | none |
| 8 | `lesestund` | Lesestund | Education | `clay` | none |

**Inquiries.** Each has a message of at least 20 characters. Every seeded transition is by Sana Holm. History and version match the steps listed.

| Reference | Name | Email | Company | Services | Budget | Timeline | Status | Steps and times |
|---|---|---|---|---|---|---|---|---|
| `NP-H4RV2K` | Elin Strand | `elin@example.com` | Brightwater Ferries | design, development | `75k_150k` | `within_3_months` | `new` | submitted 6 days before; version 1 |
| `NP-T9WQ3M` | Jonas Lind | `jonas@example.com` | Kelp and Co | branding | `25k_75k` | `3_to_6_months` | `new` | submitted 2 days before; version 1 |
| `NP-C6PZ8N` | Aino Varga | `aino@example.com` | Northfield Clinics | strategy, design | `over_150k` | `asap` | `in_review` | submitted 5 days before, review 4 days before; version 2 |
| `NP-M3XB7R` | Rafael Costa | `rafael@example.com` | Tidewell Labs | design, development | `75k_150k` | `within_3_months` | `call_booked` | submitted 4 days before, review 3 days before, booked 1 day before; call at 14:00 Stockholm on the third studio day after the Stockholm date; version 3 |
| `NP-Q7LD4V` | Mira Falk | `mira@example.com` | Larkspur Audio | design | `25k_75k` | `asap` | `call_booked` | submitted 9 days before, review 8 days before, booked 7 days before; call at 10:00 Stockholm on the last studio day at least 2 days before the Stockholm date; version 3 |
| `NP-W8DK5T` | Hanna Moe | `hanna@example.com` | Quayside Books | branding, design | `25k_75k` | `3_to_6_months` | `won` | submitted 25 days before, review 22 days before, booked 20 days before; call at 11:00 Stockholm on the last studio day at least 14 days before the Stockholm date; won 10 days before; version 4 |
| `NP-B2FJ9S` | Lukas Weber | `lukas@example.com` | Harbor Garage | development | `under_25k` | `asap` | `declined` | submitted 45 days before, declined with `budget` 40 days before; version 2 |

**Fixture status tokens.** Each seeded inquiry's status token is fixed so that its status page can be opened: `seed-` followed by the reference in lowercase without its hyphen, followed by `-status-link`. For example, `NP-Q7LD4V` has the token `seed-npq7ld4v-status-link`, and its status page is `/inquiry/seed-npq7ld4v-status-link`. These tokens are fixture data, like the password.

For example, with the seed data at start, the unfiltered counts are New 2, In review 1, Call booked 2, Won 1, Declined 1 and All 7. Seeded call times follow the Stockholm wall-clock rule (Business rules 12). No seeded name, company, email or reference contains `%`, `_` or `\`.

## Technical requirements

### Deployment (DP-01)

The runtime is Python 3.12 or later on Linux, with the PostgreSQL and Mailpit services already running.

- Deliver the source under `/app` with `/app/run.json`. It has a `"_schema": "run-manifest-v1"` entry and the string commands `install`, `build` and `serve`. `build` may be empty. For example:

  ```json
  {"_schema": "run-manifest-v1", "install": "pip install --no-cache-dir -r requirements.txt", "build": "", "serve": "python3 -m northpier"}
  ```

- The grader copies `/app`, runs `install` and `build`, then runs `serve` in the foreground, possibly as a non-root user with its own home directory.
- `serve` runs a server that handles simultaneous requests, bound to `0.0.0.0` on the port in `APP_PUBLIC_PORT`, default `4173`. It never binds `127.0.0.1` or `localhost`.
- The app and its API share one origin, `APP_PUBLIC_URL`, with the API under `/api`. The server answers requests whatever `Host` header they carry.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once the schema and seed are in place and PostgreSQL answers. Before that, and whenever PostgreSQL stops answering, it answers 503 with `{"status":"unavailable"}`. These health bodies are exempt from the error shape in API.
- The app starts with no manual step.
- Reserved `.browser_screenshots/` and `.downloads/` directories exist at `/app`.

### Configuration and secrets (DP-60)

The app reads all of these at start. None is hard-coded or sent to the browser.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP; `mailpit` and `1025` when unset |
| `APP_PUBLIC_URL` | absolute origin for status links |
| `APP_PUBLIC_PORT` | listening port |
| `NP_FLOOD_WINDOW_SECONDS` | inquiry window (Business rules 19) |
| `NP_IDEMPOTENCY_TTL_SECONDS` | key lifetime for inquiries and transitions (Business rules 5 and 18) |
| `NP_REOPEN_WINDOW_SECONDS` | reopen window (Business rules 14) |
| `NP_SIGNIN_WINDOW_SECONDS` | sign-in window (Business rules 20) |

### Server boundary (DP-04, DP-09, DP-19, DP-23, DP-34, DP-63)

- **Same origin only.** The app sends no cross-origin permission headers. Cookie-authenticated API writes from another origin get the cross-origin refusal.
- **Session cookie.** The sign-in page sets the studio session cookie as HTTP-only and same-site.
- **Request limits.** Request bodies obey the size and nesting limits in API. Every request, including a pathological one within those limits, answers within two seconds.
- **Never served.** The server never serves source files, `run.json`, `requirements.txt`, `USER_README.md`, `THIRD_PARTY_NOTICES.md`, environment files or any credential. Those addresses answer the not-found page.
- **Visitor surfaces.** Pages and the public status read never contain a studio account name, an email address other than `hello@northpier.studio`, a note, or another inquiry's token.
- **Errors.** No request, whatever its JSON types, numbers or characters, answers with a 500 or any other 5xx except the 503 outage answers, and no body carries a stack trace, SQL, a file path or a library name.
- **Outbound connections.** The app makes no network calls except to PostgreSQL and the SMTP server.
- **Unreachable at boot.** If PostgreSQL is unreachable at boot, the app keeps serving, answers health and requests as Deployment and Services state, and retries the connection every 2 seconds. The SMTP server being unreachable never blocks start.

### Browser support and performance (DP-53, DP-54)

- **Browsers and devices.** Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, by mouse, keyboard and touch, in any browser time zone.
- **Load time.** Every page shows its first content within one second on the grading machine.
- **Studio responsiveness.** The queue is usable within two seconds of navigation, and a studio action's result shows within one second of the response.

## Working rules

- **IF-01** Write `/app/USER_README.md` listing both seeded studio accounts with their roles beside the password `deku-demo-pw-2026`, and the fixture status link of `NP-Q7LD4V`.
- **IF-02** Ship `/app/run.json` with `"_schema": "run-manifest-v1"` and string `install`, `build` and `serve` commands, `install` and `serve` non-empty.
- **IF-03** Ship `/app/THIRD_PARTY_NOTICES.md` naming every shipped package with its version and licence. Shipped packages are the production dependency tree: everything `pip install -r /app/requirements.txt` installs into a clean environment, as `pip freeze` lists it, excluding test and development tools.
- **IF-04** Every shipped package carries one of these licences: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0 or LGPL-3.0-or-later.
- **IF-05** Use no datastore, cache, queue, identity provider or mail vendor besides PostgreSQL and SMTP to Mailpit, and never download, install or start a copy of either.
- **IF-06** Keep the reserved `.browser_screenshots/` and `.downloads/` directories at `/app`.
- **IF-07** Leave the provided service definitions and their credentials unchanged.

## Engineering standards

- Code is idiomatic Python with type hints on public functions. Names use this brief's domain terms: inquiry, status event, call, studio day, closure day, decline reason, lead, associate, reopen window, sign-in limit, outbox.
- The Transitions table, including its role column, is defined once. Every surface that lists, offers or applies an action reads it.
- Each domain rule is decided in exactly one place: studio hours, closure days, quarter hours, the overlap check, the reopen window, the Stockholm conversion, character counting, the hourly limit, the sign-in limit, the invitation sequence and the queue counts.
- Transitions, bookings, key claims and their outbox rows take their decision and write in one database transaction guarded by the version, the calendar and the key. There is never a read followed by an unguarded write.
- Request fields are checked for their JSON type before use, and values are never coerced across types.
- Every refusal is built through one error shape with the exact status, field and message, and nothing surfaces as a crash.
- There is no dead, commented-out or unreachable code, no abstraction with a single implementation, and no defensive check for a state the schema already forbids.
- No feature beyond this brief.
