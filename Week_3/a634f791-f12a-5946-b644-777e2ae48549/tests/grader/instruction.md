# Northfall Reference Desk

Northfall builds and installs industrial automation. Its customer reference programme writes up each finished installation, checks the story with the customer who lived through it, and publishes the cleared stories so a buyer can see what Northfall has actually delivered. Build that programme as one web product with two parts. The first is the public reference library, which a prospect reads in English and in Finnish. The second is the private desk where the library is written, ordered, previewed and published, and where a steward records how long each customer's consent lasts. Every record is stored in one backing service, Postgres. The product sells nothing. It has no visitor comments, no approval control, no video, no search and no public sign-up. Every desk account is seeded.

## Problem and users

A buyer of industrial automation is asked to trust claims they cannot check. A reference library only helps if three things hold. Every story in it must be one the customer has agreed to. It must stay public for exactly as long as they agreed. A withdrawn story must vanish completely, with no address, filter, count or error message that gives it away. Someone also has to write the library, and the person who writes a story is not always the person allowed to decide how long it stays public.

| Role | What it may do |
|---|---|
| visitor | Has no account. Reads every public route of the served programme in either language and filters the library by sector. Opens one unpublished reference through a valid preview link and sends an enquiry. Cannot reach any desk action. Cannot read a reference outside its clearance window, and cannot learn that such a reference exists. |
| curator | Belongs to exactly one programme. Creates a reference as a draft and edits its editable fields. Orders the live references, makes a preview link, publishes and retires. Reads the enquiry queue of its own programme. Cannot record a clearance window and cannot delete an enquiry. |
| steward | Belongs to exactly one programme. Does everything a curator does, and also records clearance windows and deletes enquiries. |

A **clearance window** is the pair of dates between which the customer has agreed that their story may be public. A reference is **live** while it is published, not retired, and its clearance window contains today. The programme `northfall` is served at the public origin. The programme `westhall` is stored alongside it and is never served here.

## Journeys

1. **A prospect reads the library.** A visitor with no account opens `/`. They read the promise line and the featured strip, then follow "Read the references" to the numbered index at `/references`. They pick the `food` sector and the address becomes `/references?sector=food`. They switch to Finnish and land on `/fi/references?sector=food` with the same single row. They open that reference and read its challenge, its work, its result figures and, where there is one, the customer quote. They go on to `/programme#clearance` and read that chapter below the fixed header. They end with the chapter open and its address in the address bar.
2. **A prospect leaves an enquiry.** The visitor reaches the enquiry form on `/contact` from the header, the home page, a reference detail page or the empty index. They enter a work address, optionally a telephone number and a reference of interest, tick the privacy agreement and send. The confirmation naming the reply address replaces the form. A refused submission is announced and keeps the form with each message on its own field and the typing intact. If the database is down, the outage message is announced and the typing stays, and sending again after it returns succeeds with no app restart. Sending again from the same address while the first enquiry is open shows the same confirmation, and the desk queue still holds one enquiry from that address.
3. **A prospect copies a manager's address.** On `/contact` the visitor uses the copy button on a reference manager's card, from the keyboard or with the pointer. The address is copied and the button's label shows the confirmation for about two seconds from the latest activation. If the browser refuses the clipboard, the label says so and the address is selected instead.
4. **A curator drafts and publishes.** A curator opens `/desk`, signs in, and lands on the reference list of their own programme. They create a draft and complete it from the keyboard, adding figures. Whatever else they send, only the editable fields change. They try to publish and are refused because no clearance window is recorded. A steward records a window that contains today. The curator publishes, and the reference takes the next ordinal. It appears at once on the index, in the sector filter, in the enquiry choices and at its detail address, in both languages. The curator then moves it up the order using only the keyboard. Focus stays on the moved row, the new position is announced and the totals follow. Their session ends during the next edit. They sign in again and the pending save completes with the typing intact.
5. **A reference leaves the library.** A steward narrows a live reference's window so it no longer contains today, a curator retires the reference, a curator changes content the customer cleared, or the last day of its window passes. In each case it leaves every public surface at the next request, every address it has ever held answers not found, and the remaining ordinals close up with no gap. If a steward later reopens the window, or a curator restores the retired reference, it returns exactly as it was, last in the run.
6. **A customer reviews a preview.** A curator makes a preview link for an unpublished reference and sends it to the customer. The customer opens it and reads the whole page under the preview banner, and the page is not cached or indexed. The link lasts its exact number of elapsed seconds, across a daylight-saving change too. Once the link expires, is replaced, or the reference is published, the link reads exactly like an address that never existed.
7. **A Finnish reader browses.** A visitor on any public route uses the language switch. They land on the same route, query and chapter beneath `/fi`, with the published Finnish wording in every state, including singular counts, refusals and outages. A reference with no Finnish body shows its English text under the Finnish pending-translation note, and that English text is marked as English.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Health and one origin** `GET /api/health` answers 200 once the app is ready, and the same origin serves the pages and the API under `/api`.
- **DP-02 — Seed on first boot** On first boot, with no manual step, the store holds exactly the programmes, desk accounts, references, result figures, notes, enquiries and service clock row listed in Seed data, each once, and nothing else.
- **DP-03 — Stored entities** The nine entities live in their own Postgres tables named in Data model, each with the columns listed there.
- **DP-04 — Substituted media** The served pages carry no video element and load no file from any other origin.
- **DP-05 — Nothing sold, no comments** The product exposes none of the sign-up, search, checkout, comment or reaction endpoints listed in Server boundary.
- **DP-06 — One live set** Every public read answers with the live references of the served programme and nothing else, so drafts, withheld references, retired references and the other programme's references never appear.
- **DP-07 — Index API** `GET /api/references` lists the live references in display order with the index fields listed in API, their ordinals running contiguously from one.
- **DP-08 — Detail API** `GET /api/references/{slug}` returns a live reference with the detail fields listed in API, including its result figures in order.
- **DP-09 — Reference index page** `/references` shows the index title, a count that matches its rows, the sector filter of live sectors only and one server-rendered row per live reference whose link names the reference title.
- **DP-10 — Empty index** An index with no reference to show states the empty-state sentence with the enquiry call to action instead of a blank page.
- **DP-11 — Detail page** `/references/<slug>` shows the reference with its result figures as labelled pairs and carries a title, a description and a social preview image in its head.
- **DP-12 — Home page** The home page shows the promise line in the hero, the featured strip of the first three live references and the service panels.
- **DP-13 — Reading routes** `/programme` offers four chapters, `/story` dated chapters with described images, and `/notes` dated notes newest first with no undated draft.
- **DP-14 — Unknown address** An address that matches no route answers 404 with the not-found page and a link home, never a redirect.
- **DP-15 — Withheld everywhere** A reference outside its clearance window is absent from the index, the home strip, the sector filter, the enquiry choices and the Finnish mirror, and its detail address answers 404.
- **DP-16 — Future window** A reference whose clearance window has not opened yet is withheld exactly like one whose window has closed.
- **DP-17 — Enquiry accepted** A valid enquiry answers 201, is stored with its agreement flag and reference of interest, and appears in the desk queue of the serving programme, newest first.
- **DP-18 — Enquiry refused** An enquiry with a missing or malformed address, no agreement, a short telephone number or a reference that is not live answers 422 with an `errors` map and writes nothing.
- **DP-19 — One open enquiry per address** A repeat from an address with an open enquiry joins it and keeps its first arrival time, simultaneous repeats leave one row, and once the earlier one is closed a new enquiry is its own record.
- **DP-20 — Contact route** `/contact` shows the directory of six reference managers with their copy buttons and the enquiry form with labelled fields, the required ones marked, and the submit button.
- **DP-21 — Enquiry form states** While the enquiry is in flight the submit button is disabled; success replaces the form with a confirmation naming the reply address; a refusal or an outage keeps the typing and shows its message.
- **DP-22 — Copy address control** Each directory card's copy button is operable from the keyboard, copies the address and swaps its label to the confirmation copy.
- **DP-23 — Sign in** `POST /api/auth/login` returns a bearer token for each seeded account, and every failed sign in answers 401 with one byte-identical body whether or not the address is known.
- **DP-24 — Hashed passwords** No stored account row contains a password in the clear.
- **DP-25 — Desk needs a session** A desk call carrying no bearer token, an unknown one or an ended one is refused 401.
- **DP-26 — Steward-only actions** A curator recording a clearance window or deleting an enquiry is refused 403 by the server and nothing changes, the refusal naming neither the stored dates nor the role, while a steward may do both; a request naming a role, programme, account, publication state, ordinal or window outside its own endpoint is answered as though it had named none.
- **DP-27 — Programme isolation** A desk request for another programme's reference, enquiry, preview link or ordinal answers 404 and changes nothing, and every desk list holds only the account's own programme.
- **DP-28 — Drafts and edits** A curator creates a reference as an unpublished draft with no ordinal and no window, and edits its editable fields, figures included.
- **DP-29 — Publication** Publishing a reference with at least one result figure whose recorded window contains today appends it at the end of the ordinal run, in the English and Finnish indexes at once.
- **DP-30 — Publication guards** Publishing with no recorded clearance window or no result figure, or publishing a reference that is already published, answers 409, and no such refusal moves the ordinal run or mints a preview link.
- **DP-31 — Ordinal moves** Retiring, a closing window, restoring and reordering keep the live ordinals contiguous from one; a restore and a position past the end both land last, and moving a reference that is not live is refused 409.
- **DP-32 — Concurrent publishes** Simultaneous publish requests for one reference produce one publication and one ordinal.
- **DP-33 — Preview links** A preview link carries an opaque token and an expiry and opens exactly its own unpublished reference, refusing every other slug, every moment after its expiry and every link it has been replaced by.
- **DP-34 — Preview retired by publication** Publishing a reference retires every preview link minted for it, so a link held from before publication no longer opens it once it is withdrawn.
- **DP-35 — Preview banner** A detail page opened through a valid preview link shows the preview banner without the enquiry call to action, and a page without a valid link shows no banner.
- **DP-36 — Renames redirect** Renaming a live reference moves it to the new slug, and every earlier address, in both languages and the API, redirects permanently to the current one.
- **DP-37 — Retired addresses** A retired reference answers 404 at every address it has ever held.
- **DP-38 — Finnish mirror** Every public route answers under `/fi`, and the Finnish read API serves the same live set with a detail for every live reference.
- **DP-39 — Finnish copy** The Finnish surface uses the published Finnish wording for navigation, labels, validation messages and the not-found page, and shows the pending-translation note only for a reference with no Finnish body.
- **DP-40 — Language switch and declarations** The language switch keeps the current route and its query, and each document declares its language and names the other language address, query included, as its alternate.
- **DP-41 — Global chrome** Every public route has one header and one footer, the footer carrying the sitemap, the programme name with the current year and the privacy link, and the navigation marks exactly the current page.
- **DP-42 — Cookie notice** The cookie notice appears on a first visit, no analytics cookie is set before it is answered, and it does not return once answered.
- **DP-43 — Conformance at desktop width** The home page, reference index, a reference detail, the programme, story, notes and contact routes pass a WCAG 2.2 AA audit at 1280 by 800.
- **DP-44 — Conformance at phone width** The home page and the reference index pass a WCAG 2.2 AA audit at 375 by 812.
- **DP-45 — Headings, keyboard and icons** Each public route has one level-one heading with no skipped levels, the skip link is the first keyboard stop, every keyboard stop shows the same visible focus ring and every icon is named or hidden.
- **DP-46 — Reflow at 320 pixels** The home page, reference index, programme, story and contact routes show no sideways scrolling at 320 pixels wide.
- **DP-47 — Enlarged text, targets and images** The index holds with text at twice its size, every interactive target, links inside text included, is at least 24 by 24 pixels at phone width, and every image carries explicit dimensions.
- **DP-48 — Motion and reduced motion** An index row lifts and its title darkens under the pointer, the promise line holds while the featured strip moves on, and a reduced-motion reader gets every end state with no animation on the home page, chapter panels or desk.
- **DP-49 — Editorial composition** The home page, reference index and contact route read as a printed editorial page with content on the ground rather than inside dashboard panels.
- **DP-50 — Palette** The page sits on a warm off-white ground with near-black ink and a soft lime fill on the enquiry calls to action, the header link and the home Start an enquiry link included.
- **DP-51 — Type** Display titles use a light transitional serif with tight line spacing while running prose uses a medium grotesque sans.
- **DP-52 — Index rows** The reference index is one column of full-width rows divided only by hairlines, with no cards and no shadows.
- **DP-53 — Narrow layout** At phone width the index keeps space at both edges and breaks titles only between words.
- **DP-54 — Shared article parts** The chapter, pull quote and figure pair keep one treatment on the programme and story routes.
- **DP-55 — Desk working surface** Signed in, `/desk` shows the account's references as a working list with editing controls beside each row, visibly unlike the public index.
- **DP-56 — Only the published surface** Unlisted `/api` paths answer a JSON 404, a listed path called with an unlisted method answers a JSON 405 with an `Allow` header, no framework documentation or debug route is served, and a body that is not a JSON object answers 422 with `errors.body`.
- **DP-57 — Filter state lives in the address** The sector filter is rendered on the server from the address, survives the language switch and the alternate link, and a withheld, draft-only, other-programme or unknown sector reads as the same empty filter.
- **DP-58 — Window edges** Clearance windows are judged by Helsinki calendar dates inclusive at both ends, impossible or inverted windows are refused 422, publishing against an ended window is refused 409, narrowing withdraws at once and reopening appends the reference last, as qualified in Business rules.
- **DP-59 — Only editable fields are written** Creating or editing a reference writes only the editable fields listed in API and ignores every other key in the body, the slug always coming from the title.
- **DP-60 — Keyboard reorder on the desk** Each live desk row carries move up and move down buttons that reorder from the keyboard, keep focus on the moved row, announce the new position and restore the server order on refusal.
- **DP-61 — Preview refusals look alike** Every refused preview answers the same 404 body and page as a missing reference, a valid preview is served uncacheable and unindexed, and an expiry outside the allowed range is refused 422.
- **DP-62 — The service clock** Every reading of now, on every surface, is the system instant plus the stored `service_clock` offset read fresh for each request, and no route exposes that offset.
- **DP-63 — Recovery without restart** With Postgres stopped every database route answers the published 503 within 5 seconds, service resumes without an app restart once it returns, and a boot with Postgres absent retries and then applies the seed exactly once.
- **DP-64 — Hostile input** NUL characters, lone surrogates, non-integer ordinals, loose date forms, NaN and deep nesting are refused with the published status and shape and never answer 5xx, as qualified in API.
- **DP-65 — Exact breakpoints** Layouts change exactly at 640 and 1100 pixels wide, and an open menu stays coherent across a resize.
- **DP-66 — Collapsed means unavailable** A closed chapter, a closed menu and a dismissed cookie notice leave the tab order and the accessibility tree from the moment closing starts.
- **DP-67 — Chapter addresses** The fragments `nomination`, `clearance`, `duration` and `changes` open their chapter below the fixed header from the quick navigation, a direct load or Back, and the language switch carries the current fragment.
- **DP-68 — Focus never hidden** Every keyboard stop is entirely clear of the fixed header and the open cookie notice when it takes focus, at every published width and at twice the text size.
- **DP-69 — Rollover under load** When the Helsinki date changes by one day or several, simultaneous mixed public and desk requests all answer without a 5xx and each sees the one correct run.
- **DP-70 — The desk takes state from the server** Row state, move buttons and expiry text on the desk come only from server data, whatever the browser's clock or time zone, and a stale action shows its refusal and re-reads the list.
- **DP-71 — A clearance covers the content** Changing the figures, quote, quote speaker, quote role or customer of a reference clears its recorded window in the same transaction, while identical values void nothing, as qualified in Business rules.
- **DP-72 — Announced enquiry results** Enquiry confirmations, refusals and outages are announced from live regions already in the page, each field error is tied to its field, and a retry after an outage succeeds with one request and the typing intact.
- **DP-73 — The copy control's timer** The copy confirmation lasts about two seconds from the latest activation on each card independently, focus stays on the button, and a refused clipboard shows the refusal label and selects the address.
- **DP-74 — Sessions end and the action resumes** A session lasts 8 hours from sign-in inclusive on the service clock, and a desk action caught by its end keeps the typing and resumes once after sign-in, as qualified in Interactions.
- **DP-75 — Authority read from the stored account** A changed role or programme applies on the next request under an existing token, a deleted account's token answers 401, and parallel requests from different accounts never see each other's rows.
- **DP-76 — Landing after each desk action** Sign-in and every desk action leave the address at `/desk` with the published screen state, and reloading in the same tab keeps the session while a new tab asks to sign in.
- **DP-77 — Keyboard-complete desk** The whole draft, figures, publish and retire flow works from the keyboard, each action landing on its published focus target and focus never falling to the page.
- **DP-78 — The editor survives list re-reads** A completed action on another row re-reads the list without losing the editor's typed values, caret position or row, and desk messages stay until the next action.
- **DP-79 — Live desk totals** The desk's reference totals, open enquiry count and figure count update in place after every completed action, always equal the rows shown and are unchanged by a refusal.
- **DP-80 — Lost updates** `PATCH` honours an optional `If-Match` against the reference's version, a mismatch answers 412 and changes nothing, and the desk always sends it and keeps the typing on a refusal.
- **DP-81 — Wider concurrency** Simultaneous publishes of different references award contiguous distinct ordinals, simultaneous creates with one title all succeed with distinct slugs, and publish or move racing retire leaves a contiguous run.
- **DP-82 — Elapsed-time expiry** Preview expiry counts elapsed seconds across daylight-saving changes, a link is valid at its expiry second and refused one second later, and the desk shows the expiry in correct Helsinki local time.
- **DP-83 — Previews leak nothing** Refused previews match a missing reference in status, body and headers, a valid preview page keeps its token out of every link but the language links, and renames and retirement treat a link as Business rules decides.
- **DP-84 — Exact restore** Publishing a retired reference brings back its content, figures, window and every earlier slug's redirect exactly, last in the run, with old preview links still dead.
- **DP-85 — Redirect fidelity** An earlier-slug redirect is one permanent hop that keeps the query string byte for byte, stays on the configured origin whatever the request headers claim, and is never served for a non-live reference.
- **DP-86 — Slugs from real text** Slugs come from the title in composed form, a title yielding no slug is refused 422, clashes count every current and earlier slug in the programme, and a change of case alone writes no history.
- **DP-87 — Published Finnish wording** Every string in the published Finnish table renders character for character on Finnish routes in its state, including singular counts, refusals, outages and the clipboard refusal.
- **DP-88 — Language of parts and dates** Any block in the other language carries its own language marking, and note dates read in the published English and Finnish forms.
- **DP-89 — Address fidelity and Finnish order** The language links keep the raw query byte for byte on every page kind, doubled or desk Finnish addresses answer not found, and non-live desk rows sort in Finnish alphabetical order.
- **DP-90 — Live motion preference** Changing the reduced-motion preference on an open page applies at once with no reload, and reverting it restores the effect, the promise line travelling about a quarter of the strip's distance.
- **DP-91 — Reference state machine** Desk lists and details report each reference's state as draft, live, withheld or retired, only the published edges change it, and each row shows the same word.
- **DP-92 — Repeated desk announcements** The same desk message twice in a row is announced as a fresh change each time, focus stays in the row or editor while a request is in flight, and a rapid double press of a move sends one request.

## Frontend

### Screens and layout (DP-09..DP-14, DP-20, DP-41, DP-46, DP-47, DP-49, DP-53, DP-55, DP-57, DP-65, DP-68)

| Route | Who | What it shows |
|---|---|---|
| `/` | visitor | The home page. It holds the wordmark, the promise line and the line beneath it, the two home links, and the featured strip of the first three live references in ordinal order (fewer if fewer are live). It also holds one customer quote with the speaker's name and role, and three service panels: nominating an installation, how a customer clears a story, and asking for a reference call. |
| `/references` | visitor | The reference index. It holds the page title, the count line, the sector filter, and one full-width row per live reference with its ordinal, title, sector tag and headline result figure. `/references?sector=<sector>` shows only that sector's live rows, rendered on the server. |
| `/references/<slug>` | visitor | One reference. It shows the title, sector tag, ordinal, customer name and summary, then the challenge section and the work section. It shows the result figures as labelled pairs, the customer quote where one exists, and the enquiry link. A draft previewed with no figures shows no figures section at all. |
| `/programme` | visitor | How the reference programme works, as four chapters reached from a quick navigation strip: Nomination (`nomination`), Clearance (`clearance`), How long a clearance lasts (`duration`), and Changes and removal (`changes`). Each chapter body holds at least one link. The page also carries at least one pull quote with its speaker and at least one set of figure pairs. |
| `/story` | visitor | The programme's story as four dated chapters in ascending order, with the year spans 2014–2016, 2017–2019, 2020–2022 and 2023–2026. Each chapter has a display heading, several paragraphs and one described image. The page also carries at least one pull quote with its speaker and at least one set of figure pairs. |
| `/notes` | visitor | The dated notes, newest first. Each row shows the publication date, the title and the one-line preview. A count above the rows agrees with the rows shown. A note with no publication date is a draft and does not appear. |
| `/contact` | visitor | The directory of six reference managers and the enquiry form. |
| `/fi`, `/fi/references`, `/fi/references/<slug>`, `/fi/programme`, `/fi/story`, `/fi/notes`, `/fi/contact` | visitor | The Finnish surface of each route, with the same layout. You write the running prose of the Finnish programme and story routes in Finnish. |
| `/desk` | curator, steward | The private desk, in English only. First the sign-in panel. After sign-in: the totals, the reference list of the account's own programme, the reference editor, the order controls and the enquiry queue. |

**Count line.** The index states how many rows it shows as `<count> cleared references`, using "reference" when the count is 1. On a filtered index it reads `<count> cleared references in <sector>`. `<count>` is the number of rows rendered, written in digits. `<sector>` is the sector value from the address, escaped, with any NUL character or undecodable byte dropped from the echo. The Finnish forms are in Feedback states.

**Sector filter.** This is a row of links above the index rows. The first is "All sectors" and points to the unfiltered index. Then there is one link per live sector, in alphabetical order, labelled with the sector value and pointing to `?sector=<sector>`. Only sectors held by at least one live reference appear.

**Global chrome.** A header is fixed to the top of every public route. It holds the monogram at the left, the primary navigation in the centre, and the language switch beside the header enquiry link at the right. The header keeps its place and its solid ground while the page scrolls, so a long serif heading passing beneath it stays readable. It may wrap and grow when text is enlarged. The footer repeats every public route as a sitemap and states the programme name with the current year, Helsinki date on the service clock, worked out when the page is served. It is the only place the privacy statement and the terms of participation are linked from. On a first visit a cookie notice is anchored to the bottom right, on the inverted dark ground. On a narrow screen the page keeps enough room around it for DP-68 to hold.

**The contact surface.** The directory holds six reference managers. Each is a card with a portrait filling the top, and beneath it, on the inverted ground, the name in the display serif, a role line, the direct address and a direct telephone line.

**The desk.** After sign-in the desk shows a working list of the account's own references. Live references come first in ordinal order, then the rest in the Finnish alphabetical order of Business rules. Each row shows its ordinal (or "not live"), title, sector and state word, with action buttons beside it. A totals line sits above the list and a count line above the queue. Choosing a row's edit button opens the reference editor. A steward's editor also holds the clearance window fields. The enquiry queue sits under the list, each row showing its arrival time in Helsinki time, day.month.year hours:minutes. The desk looks like a working tool: denser rows, a sans face throughout, visible input borders and buttons in a row. It does not look like the public index.

**Responsive behaviour.** Three layouts exist, and the width decides among them exactly. Wide is 1100 pixels and up, middle is 640 to 1099, narrow is 639 and below. The published test sizes are 1280 by 800 (wide), 768 by 1024 (middle) and 375 by 812 (narrow).

| Part | Wide | Middle | Narrow |
|---|---|---|---|
| Service panels across | 3 | 2 | 1 |
| Directory cards across | 3 | 2 | 1 |
| Contact route | two columns, form at the left, directory at the right | form above the directory | form above the directory |
| Primary navigation | shown | shown | folded behind "Menu" |
| "Menu" button | absent | absent | present |
| Desk editor | beside the list | below its row | below its row |

Crossing from narrow to a wider layout while the menu is open closes the menu state, reports not expanded, and shows the navigation in the header. Crossing back shows the menu closed. An open desk editor keeps its typing across any resize.

The index is one column of full-width rows at every width, and gaps and page-edge space narrow at each step down. The display serif steps down with the screen, so a reference title that fits on one line when wide takes two lines when narrow. It never overflows and it breaks only between words. Every public page stays usable at 320 pixels wide with no sideways scrolling, and with text enlarged to twice its size without any content lost or clipped.

### Public screens and controls (DP-09, DP-12, DP-20..DP-22, DP-40..DP-42, DP-45, DP-55, DP-57, DP-60, DP-67, DP-72, DP-76, DP-77, DP-79, DP-87)

These names and labels are public. Everything else about the markup is yours to choose. `<title>` is a reference's current title in the language of the page. `<email>` is the address stored on an enquiry. The Finnish forms are in Feedback states.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| every public route | link, first keyboard stop, to the main content | Skip to content |
| every public route | `banner` landmark and `contentinfo` landmark | — |
| every public route | `navigation "Primary"` holding four links, the current one marked `aria-current="page"` | References, Programme, Story, Notes |
| every English route | link "Suomi", the language switch | Suomi |
| every Finnish route | link "English", the language switch | English |
| every public route | link "Enquire" to `/contact` (Finnish route: to `/fi/contact`) | Enquire |
| narrow screens | button "Menu", which reports whether the menu is expanded | Menu |
| cookie notice | `region "Cookie notice"` holding button "Accept" and button "Close the cookie notice" | Northfall uses cookies and similar technologies to understand traffic |
| home | heading level 1 | References you can check, from installations we actually finished |
| home | text beneath the promise line | Every story here is published with the customer's written agreement |
| home | link "Start an enquiry" to `/contact` | Start an enquiry |
| home | link "Read the references" to `/references` | Read the references |
| `/references` | heading level 1 | The reference library |
| `/references` | `navigation "Sectors"` holding link "All sectors" and one link per live sector named by its value; exactly one carries `aria-current="true"` as Business rules decides | All sectors, the sector values |
| `/references` | one link per row whose accessible name contains `<title>` | ordinal, title, sector tag, headline figure |
| reference detail | link "Ask about this reference" to `/contact` | Ask about this reference |
| `/programme` | heading level 1 | How the programme works |
| `/programme` | `navigation "Chapters"` holding one link per chapter to its fragment | the chapter headings |
| `/programme` | one button per chapter header, inside the chapter's heading, named by the chapter heading, which reports whether it is expanded | the chapter headings |
| `/story` | heading level 1 | The programme so far |
| `/notes` | heading level 1 | Notes |
| `/contact` | heading level 1 | Talk to the reference desk |
| `/contact` | textbox "Work address", required | — |
| `/contact` | textbox "Telephone", optional | — |
| `/contact` | combobox "Reference of interest", optional: first choice "No particular reference", then one choice per live reference | — |
| `/contact` | checkbox "I agree to the privacy statement", required | — |
| `/contact` | button "Send the enquiry" | Send the enquiry |
| `/contact` | one empty `status` region, outside the form so it remains when the form goes, and one empty `alert` region above the submit button, both in the server-rendered page | filled per Feedback states |
| `/contact`, each directory card | button "Click to copy address" | Click to copy address |
| `/contact`, copy button after use | button "Copied to the clipboard" | Copied to the clipboard |
| `/contact`, copy button after a clipboard refusal | button "Copy not available" | Copy not available |
| unknown address | heading level 1, link to the home route and link to the index | That page is not here |
| `/desk` | `form "Sign in"` with textbox "Email", textbox "Password" and button "Sign in" | Sign in |
| `/desk` | heading level 2 "References" above the list | References |
| `/desk` | totals line above the list | per Feedback states |
| `/desk` | `list "References"` with one `listitem` per reference | the ordinal or "not live", title, sector and state word |
| `/desk`, each row | button "Edit `<title>`" | Edit |
| `/desk`, each draft or retired row | button "Publish `<title>`" | Publish |
| `/desk`, each live or withheld row | button "Retire `<title>`" | Retire |
| `/desk`, each draft or retired row | button "Make a preview link for `<title>`" | Preview link |
| `/desk`, each live row only | button "Move `<title>` up" and button "Move `<title>` down" | Up, Down |
| `/desk` | button "New reference" | New reference |
| `/desk`, editor | `form "Reference editor"` with textboxes "Title", "Summary", "Challenge", "Work", "Sector", "Customer", "Finnish title", "Finnish body", "Quote", "Quote speaker" and "Quote role", plus textboxes "Figure N label" and "Figure N value" and button "Remove figure N" for each figure N, and button "Add a figure" | — |
| `/desk`, editor | figure count line | per Feedback states |
| `/desk`, editor | button "Save the reference" (when creating: "Create the draft") | — |
| `/desk`, editor, steward only | textboxes "Cleared from" and "Cleared until" and button "Save the clearance window" | — |
| `/desk` | heading level 2 "Enquiries" above the queue, and the open enquiry count line | Enquiries |
| `/desk` | `list "Enquiries"` with one `listitem` per open enquiry | the address, the reference of interest and the arrival time |
| `/desk`, each enquiry, steward only | button "Delete the enquiry from `<email>`" | Delete |
| `/desk` | `status` live region "Desk messages", in the page before sign-in | the desk copy from Feedback states |

The desk buttons are exactly as listed. A curator's editor has no clearance-window fields; it shows the recorded window as plain text. A curator's enquiry rows have no delete button. The server still refuses both actions on its own. The product has no modal dialogs.

Every icon is drawn inline in the page, never with an icon font and never loaded as a file. Each sits in a square box and takes the colour of the text around it. There are four:
- **Arrow:** a horizontal stroke with a two-stroke chevron at its right end, inside every button and every index row link.
- **Globe:** a circle with one vertical ellipse and two horizontal chords, in the language switch.
- **Chevron:** a two-stroke open angle pointing down, on the language switch and the chapter headers.
- **Close:** two strokes crossing in the centre, on the cookie notice's close button.

An icon that is alone in a control gives the control its accessible name. An icon beside a text label is hidden from assistive technology.

### Interactions (DP-21, DP-22, DP-40, DP-42, DP-45, DP-57, DP-60, DP-66, DP-67, DP-68, DP-70, DP-72..DP-74, DP-76..DP-78, DP-80, DP-89, DP-92)

**Public pages.**
- **Language switch.** On any public route the switch links to the same route in the other language and carries the raw query string, as Business rules decides. It never links to the home page instead. On `/programme` it also carries the current fragment and follows it as the fragment changes.
- **Sector filter.** Choosing a sector link loads `/references?sector=<sector>` as a full page from the server. Back and forward move between filtered views, because each view is its own address. Choosing "All sectors" loads the unfiltered index.
- **Copy button.** Activating a copy button with Enter, Space or the pointer copies that manager's address. The label changes to the confirmation for 1.5 to 2.5 seconds, timed from the latest activation: activating again during the confirmation restarts the period. Each card times itself independently. Focus stays on the button throughout. The change is announced because the button's name changes. If the browser refuses the clipboard, the label shows the refusal for the same period and the address text is selected. It never shows the confirmation in that case.
- **Enquiry form.** Submitting sends `POST /api/enquiries`. A double click sends one request. The `alert` region empties when each send begins, so a repeated result is announced as a fresh change. After success, the confirmation fills the `status` region, the form goes, and focus moves to the confirmation. After a refusal, the refusal sentence from Feedback states fills the `alert` region, each failing field reports invalid and is described by its own message, and focus moves to the first failing field in visual order. A field's message clears when a resubmit succeeds or no longer refuses that field. After a 503 or a network failure, the outage message fills the `alert` region, the submit button is enabled again with its resting label, and all typing stays. Field messages stay as they were. A retry that reaches the recovered server completes as usual.
- **Cookie notice.** It offers "Accept" and the close button, and it does not return once either is used. Escape while focus is inside it acts as the close button. Focus then moves to the skip link's target, never to the page itself.
- **Programme chapters.** With script running, the first chapter starts open and the rest closed. With no script, all are open and the header buttons do nothing harmful. Each chapter header button opens and closes its chapter. Opening one leaves the others as they are.
- **Chapter addresses.** A quick-navigation link to `#clearance`, or a direct load of `/programme#clearance`, opens that chapter, reports it expanded, and places its heading fully below the fixed header. A direct load opens it in addition to the first chapter. Using the quick navigation also moves focus to that chapter's button. Going Back to an earlier fragment opens that chapter and places it the same way.
- **Menu.** On a narrow screen, "Menu" opens the folded navigation. Escape closes it, returning focus to "Menu".
- **Closing means gone.** A closed chapter body, a closed menu's links and a dismissed cookie notice are out of the tab order and the accessibility tree from the moment closing starts, for the whole of any closing motion, at every width. An open that interrupts a close keeps the newest state: no earlier timer re-hides it.
- **Keyboard order.** Tab and Shift+Tab reach every control in the order it appears, starting with the skip link. Every control is a real link, button or form field, never a bare block with a click handler. Each stop's whole box lands clear of the fixed header and of the open cookie notice, at 1280, 375 and 320 pixels wide and at twice the text size, the skip link's target included.

**Desk.**
- **Sign-in and session.** Submitting the sign-in form calls `POST /api/auth/login`. The address stays `/desk`. The bearer token is kept for the browser tab session only and never lands in any address or cookie. Reloading in the tab stays signed in and shows the same list. A new tab asks to sign in.
- **Desk actions.** Each desk button calls its endpoint. While the call is in flight, that row's or form's buttons refuse a second press, and a rapid double press sends one request. Focus stays on an element in the row or editor throughout. On completion the list, the queue and the totals are re-read from the server and the result is announced in "Desk messages". Messages stay until the next action; no timer clears them. Row state, move buttons and expiry text come only from what the server returned. The browser never works out live or withheld from its own clock.
- **Focus target after each action.** Focus never falls to the page.

| Action | Focus lands on |
|---|---|
| sign in | the "References" heading |
| "New reference" | "Title" |
| "Create the draft" succeeds | "Add a figure"; the editor stays open on the draft, and its button becomes "Save the reference" |
| "Add a figure" | the new "Figure N label" |
| "Remove figure N" | the next figure's Remove button, else "Add a figure" |
| Save succeeds | stays on the Save button |
| Save or clearance refused on fields | the first failing field |
| Save the clearance window succeeds | stays on its button |
| Publish succeeds | that row's Retire button |
| Retire succeeds | that row's Publish button |
| Make a preview link | stays on that button |
| Publish, retire or preview refused | stays on the pressed button if it still exists, else that row's Edit button |
| Delete an enquiry | the next enquiry's Delete button, else the "Enquiries" heading |
| Escape in an editor with no unsaved change | the editor closes; the row's Edit button, or "New reference" for a new draft |
| Escape in an editor with unsaved changes | stays in the editor with the unsaved-changes message; a second Escape discards and closes as above |

- **Figures.** "Add a figure" is disabled at 6 figures. A Save sends `figures` whenever the editor holds at least one figure, or when the reference had figures and now has none. A reference that never had figures sends no `figures` key.
- **Keyboard reorder.** Pressing Enter or Space on "Move `<title>` up" or "Move `<title>` down" sends `PUT /api/desk/order` with the row's ordinal one lower or one higher, then re-renders the list in the new order.
  - Focus stays on the same button of the moved row. If that button has just become disabled because the row reached an end, focus moves to the row's other move button.
  - The first live row's up button and the last live row's down button are disabled.
  - If the server refuses the move, the list is re-read and shown in the server's current order. If the pressed button still exists, focus stays on it; otherwise focus moves to that row's Edit button. For example, on a desk left open past a window's last day, the row loses its move buttons and focus lands on its Edit button.
- **The editor stays through re-reads.** With an editor open and unsaved typing, a completed action on any other row re-reads the list without losing typed values, caret position or the editor's association with its row, including below the row at narrow width. If the row's own slug changes, the editor follows the new slug. An action from this desk on the editor's own row refreshes the version the editor holds and keeps the typing.
- **Lost updates.** Every Save sends `If-Match` with the version the editor holds. On a 412 the typing stays and the refusal is announced.
- **A session ending mid-action.** A 401 on any desk action keeps the editor and all typing in place and shows the sign-in panel. The session-ended message is announced and focus moves to "Email". A failed sign-in shows its refusal and keeps the pending action. After sign-in:
  - to an account of the same programme that may act, the pending action retries once, with its original payload, and reports its usual success;
  - to an account of the same programme that may not act, the action's 403 message shows and the typing stays;
  - to an account of another programme, the pending action is discarded, nothing is written, the editor closes, and that programme's list shows.

### Visual design (DP-49..DP-55)

The product is an editorial layout on a warm page. It should feel like a printed magazine, not a dashboard.

**Colour.**
- The page is a warm off-white, like uncoated paper, with near-black ink that has a slightly warm cast.
- Secondary text and the inverted panels (directory cards, cookie notice) use a deep warm grey. Text on those panels is the off-white of the page.
- One soft lime fills every enquiry call to action: the header "Enquire" link, the home "Start an enquiry" link, the "Ask about this reference" link, and the enquiry link in the empty index. Ink text sits on the lime.
- One vivid red marks the current page in the primary navigation, as a small filled dot before its label. That dot is the only visible marker of the current page.
- A light warm grey draws the hairlines between index rows.
- Form fields and the desk sit on a slightly brighter paper tone.
- A soft teal marks the enquiry confirmation and desk success messages. A muted brick red marks field errors.

**Type.**
- Headings use a transitional serif at a light weight. Letters sit slightly closer than normal and lines pack tightly, so a three-line headline reads as one block.
- Body copy, small capitals labels, controls and the whole desk use a grotesque sans at a medium weight.
- The home page title is about four times the size of body text on a wide screen and about two and a half times on a phone. Index row titles are about twice body size. There are six heading sizes in total, with a large-paragraph size beneath them.
- The serif is for display only: page titles, reference titles, index rows and pull quotes. Running prose is always in the sans.

**Space and composition.** The page uses one consistent edge inset and one consistent gap between columns, both reduced at the middle width and again on a phone. Content sits directly on the page ground and is separated by hairlines and generous white space, not boxes. At rest an index row title is a lighter grey than the body text, so the index reads as a quiet column. The ordinal and the result figure stay in full-strength ink because they carry information.

**Shared parts.** One treatment is used wherever a long read appears, on both the programme route and the story route:
- **Chapter:** an eyebrow, a serif heading and sans paragraphs.
- **Pull quote:** large serif text with a hairline above and the speaker in the sans beneath.
- **Figure pair:** a large value over a small label.

**Targets and accessibility.** Buttons and form controls are at least 44 pixels in each direction. Every interactive target, including links inside running text, is at least 24 by 24 pixels; this product takes neither the spacing exception nor the inline-link exemption.

The product conforms to WCAG 2.2 at level AA:
- Text meets contrast against its own background. That includes the pale index title at rest on the warm page, ink on lime, and off-white on the deep grey panels.
- Every control shows the same visible focus ring when it has focus: a dark ink ring with a small gap between it and the control. The ring is never removed.
- An image that carries meaning has alternative text describing what it shows. A decorative image is hidden from assistive technology. Directory portraits are meaningful; the texture behind the promise line is decorative. Each story image's description describes the photograph rather than repeating the chapter heading.
- Every form field is tied to its label. An error is tied to its own field and announced when it appears. A required field is marked as required to assistive technology, not only with a symbol.

### Motion and effects (DP-48, DP-60, DP-66, DP-90)

Motion uses a small, consistent set of timings, and nothing loops or moves on its own. No decorative loop exists anywhere:
- **Hover and focus colour or fade changes:** take about a third of a second and ease gently to rest.
- **Elements entering or leaving the page:** take a little over half a second, starting quickly and gliding to a stop.
- **Index row lift and desk row move:** take about a fifth of a second and are crisp.

The named moments:
- **Heading arrival.** On a page's first paint a level-one heading arrives one line at a time. Each line rises into place from behind a mask at its own baseline, and the lines start a tenth of a second apart.
- **Index row hover.** When the pointer crosses an index row, or the row link receives keyboard focus, the row lifts by a few pixels and its title moves from the resting grey to full ink. It returns when the pointer leaves or focus moves on.
- **Chapter panel.** A chapter on `/programme` opens by growing taller, which pushes the chapters below it down. It never slides over its neighbours.
- **Cookie notice.** It rises in from below the bottom edge of the window and leaves the same way.
- **Desk row move.** When a desk row moves, it slides from its old place to its new one and its neighbour slides the other way. The motion finishes within about a fifth of a second.

The signature interaction is on the home page. The promise line stays put while the featured strip behind it travels upward. Over the first full screen of scroll, the promise line moves about a quarter as far as the strip (between a fifth and three tenths), so the line seems to stay still while the references pass beneath it. Scrolling back retraces this exactly, step by step. On `/story` a year marker at the side shows exactly one year span at a time. The span changes as each dated chapter crosses the middle of the window, and scrolling back steps it back. Both effects add to a page that already reads correctly from top to bottom.

When the reader has asked for reduced motion, every one of these moments shows its end state at once, with no animation and no movement: headings, rows, chapter panels, the cookie notice and desk row moves. The promise line sits in its normal place in the flow. Every year marker is printed beside its own chapter. No text is ever held invisible waiting for a scroll position.

The preference is followed live. Turning it on while a page is open applies all of this at once with no reload, including any motion under way, and scrolling then moves nothing out of the flow. Turning it off restores the effects, also with no reload.

### Feedback states (DP-10, DP-14, DP-21, DP-22, DP-35, DP-39, DP-57, DP-60, DP-70..DP-74, DP-79, DP-80, DP-87, DP-92)

**Enquiry form.** It has five states:

| State | What the visitor sees |
|---|---|
| at rest | the fields and "Send the enquiry", with both live regions present and empty |
| in flight | the submit button is disabled and its label reads `Sending…` |
| success | the `status` region, in teal, reads `Thank you, the desk will reply from hello@example.com`, and the form is gone |
| refused | the `alert` region reads `Check the marked fields and send again.`; each refused field is marked with its message attached (the `errors` message from API on English routes, the Finnish table's wording on Finnish routes), and everything typed is still in place |
| outage | the `alert` region reads `The desk cannot take enquiries right now. Nothing was sent; please try again shortly.`, and everything typed stays in place |

The success copy is the same whether the enquiry made a new record or joined an open one.

**Desk.** Every desk message appears in the `status` region "Desk messages", except the sign-in refusal. A message identical to the one showing is still a fresh change: the region empties first, then takes the text. `<N>` is the moved reference's new ordinal and `<M>` is the number of live references after the move.

| Action | Pending | Success | Refused |
|---|---|---|---|
| sign in | `Signing in…` on the button, which is disabled | the list replaces the panel | an `alert` in the panel shows the `message` from the 401 body |
| move | the row's buttons refuse a second press | `<title> moved to position <N> of <M>` | `The order could not be changed` |
| publish | `Saving…` | `<title> is published` | the `message` from the refusal body |
| retire | `Saving…` | `<title> is retired` | the `message` from the refusal body |
| save the reference or create the draft | `Saving…` | `Saved`; when the response reports a voided clearance, `Saved. Record a new clearance window for <title>.` | field messages attached to their fields; on a 412, the `message` from the body |
| save the clearance window | `Saving…` | `Clearance window saved for <title>` | field messages attached to their fields |
| make a preview link | `Saving…` | `Preview link ready: <link> (expires <expiry>)`, where `<link>` is the full address on the public origin and `<expiry>` is the expiry in Helsinki time as day.month.year hours:minutes, with no leading zero on day or month and two digits for hours and minutes | the `message` from the refusal body |
| delete an enquiry | `Saving…` | `Enquiry deleted` | the `message` from the refusal body |
| any desk action with a `503` or the server unreachable | — | — | `The desk cannot be reached. Your change was not saved.` |
| a session ended during an action | — | — | `Your session has ended. Sign in to finish.` |
| Escape with unsaved changes | — | `Unsaved changes. Press Escape again to discard.` | — |

For example, a link minted at 2026-10-22 12:00 Helsinki time with the default expiry shows `29.10.2026 11:00`.

**Desk totals.** These update in place after sign-in and after every completed desk action, from the re-read, and stay unchanged after a refusal. They also pick up any rollover at that re-read. They do not poll.
- Above the list: `<L> live, <W> withheld, <D> drafts, <R> retired`, always in that form, always with digits, even at 1. Each number counts the rows of that state in the list. For example, with the seed data at start as a `northfall` account: `3 live, 1 withheld, 1 drafts, 0 retired`.
- Above the queue: `<N> open enquiries`, always in that form.
- In the editor: `Figures <n> of 6`, updating as figures are added or removed, before any save.

**Other English copy.**
- Index empty state: `No reference is cleared for publication at the moment`, followed by the lime enquiry link.
- Preview banner: `Preview: the reference is not published`.

**Published Finnish copy.** Finnish routes show exactly these strings. `<n>` is in digits. `<sector>` is as in the count line.

| State or label | Finnish |
|---|---|
| Primary navigation | `Referenssit`, `Ohjelma`, `Tarina`, `Muistiinpanot` |
| index count, 1 row | `1 hyväksytty referenssi` |
| index count, 0 or 2 or more rows | `<n> hyväksyttyä referenssiä` |
| filtered count, added after the count | `toimialalla <sector>` |
| skip link | `Siirry sisältöön` |
| header enquiry link | `Tiedustele` |
| menu button | `Valikko` |
| home heading | `Referenssejä, jotka voit tarkistaa, toimituksista, jotka todella saimme valmiiksi` |
| home line beneath it | `Jokainen tarina julkaistaan asiakkaan kirjallisella suostumuksella` |
| home links | `Aloita tiedustelu`, `Lue referenssit` |
| index heading | `Referenssikirjasto` |
| filter navigation name and first link | `Toimialat`, `Kaikki toimialat` |
| detail enquiry link | `Kysy tästä referenssistä` |
| programme heading | `Näin ohjelma toimii` |
| chapter navigation name | `Luvut` |
| chapter headings, in order | `Nimeäminen`, `Hyväksyntä`, `Hyväksynnän kesto`, `Muutokset ja poistaminen` |
| story heading | `Ohjelman vaiheet` |
| notes heading | `Muistiinpanot` |
| contact heading | `Keskustele referenssitoimiston kanssa` |
| form labels | `Työosoite`, `Puhelin`, `Kiinnostava referenssi`, `Hyväksyn tietosuojaselosteen` |
| first reference choice | `Ei mitään tiettyä referenssiä` |
| submit and in flight | `Lähetä tiedustelu`, `Lähetetään…` |
| `email` error | `Anna työosoite, johon toimisto voi vastata` |
| `agreed` error | `Hyväksy tietosuojaseloste valitsemalla ruutu` |
| `phone` error | `Anna vähintään kymmenen merkin puhelinnumero` |
| `reference` error | `Valitse referenssi kirjastosta` |
| enquiry refusal, in the `alert` region | `Tarkista merkityt kentät ja lähetä uudelleen.` |
| enquiry success | `Kiitos, toimisto vastaa osoitteesta hello@example.com` |
| enquiry outage | `Toimisto ei voi juuri nyt ottaa vastaan tiedusteluja. Mitään ei lähetetty; yritä pian uudelleen.` |
| outage page | `Referenssitoimisto ei ole juuri nyt käytettävissä` |
| not-found heading | `Sivua ei löydy` |
| not-found links | `Etusivu`, `Referenssit` |
| index empty state | `Yksikään referenssi ei ole tällä hetkellä hyväksytty julkaistavaksi` |
| preview banner | `Esikatselu: referenssiä ei ole julkaistu` |
| copy button, confirmation, clipboard refusal | `Kopioi osoite`, `Kopioitu leikepöydälle`, `Kopiointi ei onnistu` |
| cookie notice region and text | `Evästeilmoitus`, `Northfall käyttää evästeitä ja vastaavia tekniikoita liikenteen ymmärtämiseen` |
| cookie buttons | `Hyväksy`, `Sulje evästeilmoitus` |
| pending-translation note | `Tämä tarina on vielä kääntämättä` |

The API stays in English. A Finnish page maps each `errors` key to the table's wording and never shows the API's English message. Accessible names on Finnish routes use the same Finnish wording.

## Backend

### API (DP-01, DP-07, DP-08, DP-17..DP-19, DP-23, DP-25..DP-34, DP-38, DP-56..DP-61, DP-64, DP-71, DP-74, DP-80, DP-82, DP-91)

**Format.** Every `/api` response is JSON with `Content-Type: application/json`. A write body is read as JSON whatever content type it declares, and may be at most 65,536 bytes; 65,536 bytes is allowed. Every refusal uses one of two shapes:
- `{"errors": {<field>: <message>}}` for invalid input;
- `{"message": <text>}` for everything else.

Every `/api` 404, whatever its cause, is the byte-identical body `{"message":"Not found"}`. `HEAD` on a path that lists `GET` answers as `GET` does, with no body.

**Error precedence.** One order applies across the whole API, and the first rule that matches answers:
1. A path not in this list answers `404`. A listed path called with a method it does not list answers `405` with `{"message":"Method not allowed"}` and an `Allow` header naming the methods listed for that path (it may also name `HEAD` beside `GET`).
2. A body over the size limit answers `413` with `{"message":"Request body too large"}`.
3. A desk call with no bearer token, an unknown one or an ended one answers `401` with `{"message":"Sign in to use the desk"}`.
4. A body that is required or optional and is not a JSON object answers `422` with `{"errors":{"body":"Send a JSON object"}}`. That covers malformed JSON, invalid UTF-8, an array, a string, a number, `NaN`, `Infinity` or `-Infinity` anywhere in the body, and nesting of any depth that fits the size limit, such as 60,000 opening brackets. This is never a `400`, a `500` or a framework error list. This rule applies only to a non-empty body. An empty or absent body is read as `{}`. On an endpoint whose body is optional or none, that is a valid request: for example, a preview mint with no body is a default-expiry mint. On an endpoint that requires fields, its field rules answer.
5. A reference, enquiry or preview link that does not exist or belongs to another programme answers `404`.
6. A role that may not act answers `403` with `{"message":"Your account cannot do this"}`.
7. A state conflict answers `409` with its message below, and a failed `If-Match` answers `412`.
8. Invalid fields answer `422` with `errors` keyed by field.

After rules 1 and 2, any listed route that needs the database while it is unreachable answers the outage `503` from Server boundary before rules 3 to 8.

**Hostile input.** A JSON string holding U+0000 or a lone surrogate is an invalid field: `422` keyed by that field, on every endpoint with field rules, with `figures` as the key for one inside a figure. At sign-in it is the standard failed sign-in. A key this API ignores is ignored whatever it holds. Hostile paths and query values never answer 5xx. Their exact page and API answers are in Business rules.

**Public reads.** Each takes `GET` only.

| Path | Success |
|---|---|
| `/api/health` | `200` `{"status":"ok"}` once ready; `503` `{"status":"starting"}` before that or while Postgres is unreachable |
| `/api/references` | `200`: an array of the live references of `northfall` by ordinal ascending, each `{"slug","ordinal","sector","title","result"}`, where `result` is `{"label","value"}` of figure position 1, which every live reference has because publishing needs at least one figure. With `?sector=<sector>`, only that sector's live references, ordinals unchanged |
| `/api/references/{slug}` | `200`: `{"slug","ordinal","sector","customer","title","summary","challenge","work","figures","quote"}`, where `figures` is `[{"label","value"}]` in position order and `quote` is `{"text","speaker","role"}` or `null`. With `?preview={token}`, as Business rules decides |
| `/api/sectors` | `200`: an array of the distinct sectors of the live references, alphabetical |
| `/api/notes` | `200`: an array of the dated notes, newest first, each `{"slug","title","preview","published_on"}` |
| `/api/fi/references`, `/api/fi/references/{slug}`, `/api/fi/sectors`, `/api/fi/notes` | the same answers from the same live set. On the references, `title` is `title_fi` where one is written. The detail adds `"translated"` (true when a Finnish body is written) and `"body"` (the Finnish body, or `null`) |

**Enquiries.** `POST /api/enquiries` takes `{"email", "phone"?, "reference"?, "agreed"}`:
- On success it answers `201` with `{"id": <enquiry id>, "reply_to": "hello@example.com"}`. A repeat that joins an open enquiry answers `201` with that enquiry's `id`.
- On refusal it answers `422` with every failing field at once, using these messages:
  - `email` is missing, not a string, longer than 254 characters, or not of the form local part @ domain with a dot in the domain: "Enter a work address the desk can reply to".
  - `agreed` is not the JSON value `true`: "Tick the box to agree to the privacy statement".
  - `phone` is given and is not a string, or is shorter than 10 characters: "Enter a telephone number of at least ten characters".
  - `reference` is given, not null and not empty, and is not the slug of a live reference of `northfall`: "Choose a reference from the library".

**Sign in.** `POST /api/auth/login` takes `{"email","password"}` and answers `200` with `{"token": <bearer token>, "role": "curator"|"steward"}`. Any failure, including an unknown address, a wrong password, a missing field or a hostile string, answers `401` with the byte-identical body `{"message":"The address or password is not right"}`. The session's lifetime is in Business rules.

**Desk.** Every desk call carries `Authorization: Bearer <token>`, and every desk list and lookup is limited to the account's own programme.

| Method and path | Request | Success | Its own refusals |
|---|---|---|---|
| `GET /api/desk/references` | — | `200`: array of `{"slug","title","sector","state","published","live","ordinal","clearance_from","clearance_until"}`, live first by ordinal, then the rest in the Finnish order of Business rules | — |
| `POST /api/desk/references` | editable fields; `title`, `sector`, `customer`, `summary`, `challenge` and `work` required | `201` `{"slug"}`, an unpublished draft | `422` keyed by field |
| `GET /api/desk/references/{slug}` | — | `200`: every editable field plus `slug`, `state`, `version`, `published`, `live`, `ordinal`, `clearance_from` and `clearance_until` | — |
| `PATCH /api/desk/references/{slug}` | any editable fields; optional header `If-Match: "<version>"` | `200` `{"slug","version","clearance_voided"}`: the current slug, the version after the write, and `true` only if this write cleared a recorded window | `412` `{"message":"This reference has changed since you opened it"}`; `422` keyed by field |
| `POST /api/desk/references/{slug}/publish` | none | `200` `{"slug","ordinal"}`, where `ordinal` is `null` while a future window withholds it | `409` as Business rules decides |
| `POST /api/desk/references/{slug}/retire` | none | `200` `{"slug"}` | `409` `{"message":"This reference is not published"}` |
| `PUT /api/desk/references/{slug}/clearance` | `{"clearance_from","clearance_until"}` as `YYYY-MM-DD` | `200` `{"slug","clearance_from","clearance_until","live"}` | `403` for a curator; `422` keyed `clearance_from` and/or `clearance_until` |
| `POST /api/desk/references/{slug}/preview` | optional `{"expires_at"}` written `YYYY-MM-DDThh:mm:ss` followed by `Z` or an offset `+hh:mm` or `-hh:mm`; an empty or absent body mints with the default expiry | `201` `{"token","expires_at"}`, `expires_at` in that form | `409` `{"message":"This reference is already published"}`; `422` keyed `expires_at` |
| `PUT /api/desk/order` | `{"slug","ordinal"}` | `200`: the run as an array of `{"slug","ordinal"}` | `409` `{"message":"Only a live reference can be moved"}`; `422` keyed `slug` or `ordinal` |
| `GET /api/desk/enquiries` | — | `200`: the open enquiries, newest first, each `{"id","email","phone","reference","created_at","agreed"}`, `created_at` in the `expires_at` form | — |
| `DELETE /api/desk/enquiries/{id}` | — | `204` with no body | `403` for a curator |

On `PUT /api/desk/order`, a `slug` that is missing, not a string or hostile answers `422` keyed `slug`. A string naming no reference of the account's programme answers the standard `404`. `ordinal` must be a JSON integer: `true`, `2.0`, `2.5`, `"2"` and a missing value are refused `422` keyed `ordinal`, and so is an integer below 1. A very large integer such as `10**30` places the reference last. An enquiry `{id}` that is not an integer, or does not fit in 64 bits, answers the standard `404`.

**Editable fields.** These are the only keys a create or edit writes:
- `title`: 1 to 120 characters.
- `summary`, `challenge`, `work`: each a non-empty string.
- `sector`: 1 to 40 characters of lowercase letters and hyphens, starting with a letter.
- `customer`: 1 to 120 characters.
- `figures`: an array of 1 to 6 objects, each with a non-empty string `label` and a non-empty string `value`. On create it may be left out.
- `quote`, `quote_speaker`, `quote_role`: each a string or `null`. An empty string is stored as `null`.
- `title_fi`, `body_fi`: each a string or `null`. An empty string is stored as `null`.

Every other key is ignored and the editable keys in the same body are still applied. Ignored keys include `published`, `ordinal`, `clearance_from`, `clearance_until`, `programme_id`, `programme`, `account_id`, `role`, `id`, `slug`, `state`, `version`, `retired_at`, `created_at`, and any key inside a figure other than `label` and `value`. A PATCH body with no editable key changes nothing and answers `200`. Desk field messages are yours to word; the keys are fixed. A desk path naming an earlier slug answers `404`, because the desk addresses a reference only by its current slug.

**`Allow` values.**
- `GET`: `/api/health`, `/api/references`, `/api/references/{slug}`, `/api/sectors`, `/api/notes`, every `/api/fi` path, and `/api/desk/enquiries`.
- `POST`: `/api/enquiries`, `/api/auth/login`, and the `publish`, `retire` and `preview` paths.
- `PUT`: the `clearance` path and `/api/desk/order`.
- `GET, POST`: `/api/desk/references`.
- `GET, PATCH`: `/api/desk/references/{slug}`.
- `DELETE`: `/api/desk/enquiries/{id}`.

### Business rules (DP-06, DP-15, DP-16, DP-19, DP-26..DP-37, DP-57..DP-62, DP-64, DP-69, DP-71, DP-74, DP-75, DP-80..DP-86, DP-88, DP-89, DP-91)

**The service clock.** Every reading of now is the system instant plus `service_clock.offset_seconds`, read fresh for each request and held to the whole second. It is the rehearsal clock for date rollovers, changed only in the database. No HTTP route reads it out or sets it. It governs today, preview minting and expiry, session expiry, a new enquiry's `created_at`, `retired_at`, and the footer year. No time is taken from the database's own clock or from a column default.

**Today and the clearance window.** "Today" is the calendar date in Europe/Helsinki on the service clock. A daylight-saving day counts as one date, and Helsinki's date changes at 21:00 UTC in summer and 22:00 UTC in winter. Both window dates are inclusive. A reference whose `clearance_until` is today stays live for all of today. A reference whose `clearance_from` is today is live today.

A steward's window is refused `422` and the stored dates stay as they were when:
- either date is missing, not a string, not exactly `YYYY-MM-DD` (so `20260203` and `2026-W01-1` are refused) or not a real date (for example `2026-02-30`), keyed on that field; or
- `clearance_from` is after `clearance_until`, keyed `clearance_until`.

A one-day window, where both dates are the same, is valid. A window may be recorded on a reference in any state.

**Reference states.** Every reference is in exactly one state, reported as `state`:
- `draft`: not published, never retired since it was last published.
- `live`: published, and its window contains today.
- `withheld`: published, and its window does not contain today or has been cleared.
- `retired`: retired by a curator or steward. `retired_at` holds the instant, and is null in every other state.

The legal edges:

| From | To | By |
|---|---|---|
| draft | live or withheld | publish |
| live | withheld | the window, by date, by a steward, or by a clearance void |
| withheld | live | the window, by date or by a steward |
| live or withheld | retired | retire |
| retired | live or withheld | publish (a restore) |

Every other edge is refused: publishing a live or withheld reference and retiring a draft or retired reference answer their `409`s below. A window recorded on a draft or retired reference does not change its state.

**The live set governs every public read.** Every public read answers with the live references of `northfall` and nothing else, in English and Finnish alike. That covers the index and its count, the home strip, the sector filter, `/api/sectors`, the enquiry choices and the enquiry `reference` check, and the detail pages and API. A reference outside its window answers not found at its detail address, whether its window has closed or has not opened yet. A change made on the desk shows on every public surface at the next request.

**Narrowing and reopening.** A steward who narrows a live reference's window so that it no longer contains today withdraws the reference at once: the next public read no longer shows it, the run closes up and every address it held answers not found. A steward who widens the window of a withheld reference so that it now contains today returns it to the live set at the end of the run. It takes the next ordinal, never its old one. A window change that leaves a live reference live leaves its ordinal alone.

**A clearance covers the content.** The customer clears the story's figures and quote together. A PATCH that changes `figures`, `quote`, `quote_speaker`, `quote_role` or `customer` on a reference with a recorded window clears both dates in the same transaction as the edit, in any state.
- A live reference becomes withheld: it leaves every public surface, its ordinals close up and its earlier slugs answer not found. A new window returns it last, by the reopening rule.
- Values are compared after the empty-string rule of API. Figures compare by `label` and `value`, in order. Resubmitting identical values voids nothing, and keys inside a figure other than `label` and `value` do not count as changes.
- Changing only `title`, `summary`, `challenge`, `work`, `sector`, `title_fi` or `body_fi` voids nothing.
- With no recorded window, no edit reports a void.

**Ordinals.** Within one programme the live references always carry the whole numbers from 1 upward, in display order, with no gap and no repeat. A reference that is not live has no ordinal, and the stored `ordinal` column holds null. The stored run matches the live set whenever a request is answered, on every route that reads or checks it, public or desk, in either language.

**Rollover.** The first request after today changes, by one day or several, in either direction, updates the stored run of every programme before it answers:
1. References leaving the live set are removed.
2. Those that stay keep their relative order and are renumbered from 1.
3. References joining are added at the end, ordered by `clearance_from` and then by slug.

Under simultaneous mixed requests, each answers without a 5xx, and each sees the one correct run.

The writes that change the run:
- **Publishing** appends the reference.
- **Retiring** removes it and closes the gap.
- **Restoring** appends it at the end, never at its old place.
- **A move** places one live reference at the requested ordinal and shifts the others. An ordinal past the end places it last. Moving a reference that is not live is refused `409` and the run is unchanged.

Simultaneous moves are applied one at a time, in arrival order, each against the run as it then stands.

**Publication.** A publish request, on a draft or as a restore, is checked in this order, and each refusal leaves the run and every preview link exactly as they were:
1. A live or withheld reference is refused `409` with `{"message":"This reference is already published"}`.
2. A reference with no recorded window is refused `409` with `{"message":"Record a clearance window before publishing"}`.
3. A reference whose window ended before today is refused `409` with `{"message":"The clearance window has ended"}`.
4. A reference with no result figure is refused `409` with `{"message":"Add at least one result figure before publishing"}`.

A window that contains today publishes the reference live at the end of the run. A window that starts after today publishes it withheld, with no ordinal, and it joins the end of the run on the day the window opens.

**Concurrency.**
- Several publish requests for one reference at the same moment: exactly one succeeds and the rest receive the already-published `409`, leaving one publication and one ordinal.
- Publishes of different references at the same moment all succeed, with contiguous distinct ordinals.
- Creates with one title at the same moment all answer `201`, with distinct suffixed slugs.
- A publish or move racing a retire leaves a contiguous run, whichever wins.
- PATCHes that each change a reference and carry `If-Match` for one version at the same moment give exactly one `200`; the rest answer `412`.

**Versions.** `reference_entry.version` starts at 1 and increases by one on any write that changes the reference: an edit, a window, a void, a publish, a retire or a restore. Moves and rollover do not count, and a PATCH that changes nothing does not count. `If-Match: "<version>"` must match the stored version, and `*` matches any version. A mismatch or a malformed value, including an unquoted version, answers the `412` and changes nothing. With no header, no check is made.

**Retiring.** A retired reference answers not found at every address it has ever held, including earlier slugs in both languages and the API, and any preview link minted for it before. A redirect that leads to a withheld record would reveal that record, so none is served.

**Restoring.** A restore brings back exactly what was retired: content, figures, quote, Finnish text, window and slug history, each unless edited since. Every earlier slug redirects again. Only the ordinal is new, and it is last. Preview links from before stay dead. A rename during retirement records history as usual, and those redirects start only once the reference is live. A withheld reference that reopens behaves the same way.

**Preview links.** A curator or steward mints a link for one draft or retired reference of its own programme. A live or withheld reference refuses minting with its `409`.
- **Token:** at least 32 URL-safe characters, random, and never containing the slug.
- **Expiry:** expiry counts elapsed seconds, never calendar days or wall-clock time. With no `expires_at`, the link expires exactly 604,800 seconds after minting. An `expires_at` that is not after now, is more than 2,592,000 seconds after now, has no offset or is not in the published form is refused `422` and nothing is minted. Exactly 2,592,000 seconds is allowed. A link is valid at its expiry second and refused one second later. For example, a default link minted at 2026-10-22 12:00 Helsinki time expires at 2026-10-29 11:00 Helsinki time, because the clocks go back in between.
- **Replacement:** minting a new link for a reference retires every earlier link for that reference. Retiring a reference retires every link minted before it, and publishing a reference retires every link minted for it.
- **Renames:** a link belongs to its reference, not to a slug. A link minted before a rename fails at the old slug and opens at the new one, and no redirect is ever served for it.

A valid link opens exactly its own reference:
- at `GET /api/references/{slug}?preview={token}` and `GET /api/fi/references/{slug}?preview={token}`, as the full detail;
- at the pages `/references/<slug>?preview=<token>` and `/fi/references/<slug>?preview=<token>`, under the preview banner and without the enquiry link.

The link grants nothing else. It does not list the reference, it does not open a sibling reference, and it cannot change anything. A valid preview response carries `Cache-Control: private, no-store`, `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`, and the preview page also carries `<meta name="robots" content="noindex">`. On a preview page, no internal navigation link, canonical address or social address holds the token. Only the language switch and the alternate link carry the query.

Every refused preview read answers `404` and looks exactly like an address that never existed. That covers:
- an unknown or hostile token, `?preview=%00` included;
- a token presented against another slug;
- an expired token;
- a token that has been replaced or retired;
- a withheld, retired or draft slug with no token;
- an earlier slug carrying any `preview` value, when the reference is not live.

The API body is the standard 404 body, with the same status and the same `Cache-Control` and robots headers as `GET /api/references/no-such-slug`. The page has the same main region and the same `Cache-Control` and robots headers as any unknown address in that language. Nothing in a refusal says "expired", "invalid" or "preview", or names the reference. On a live reference the `preview` parameter is ignored and the reference is served as usual.

**Sector filter.** `?sector=<sector>` on `/references`, `/fi/references`, `/api/references` and `/api/fi/references` keeps only the live references whose sector equals the value exactly, with case counted. An empty value means no filter. When the parameter is repeated, the first value is used. Every other query parameter is ignored.

A value that matches no live reference answers `200` with the empty state, a count of 0 and an API `[]`. That applies whether the sector is held only by a withheld reference, only by a draft, only by the other programme, or by nothing at all, and to hostile values such as `%00`. With the sector text removed, the page's main region is byte-identical across all of these.

Exactly one filter link is marked `aria-current="true"` when the page is unfiltered or names a live sector: "All sectors" when unfiltered, otherwise that sector's link. When the page names any other value, no filter link is marked current.

**Slugs and their history.**
- **Making a slug:** the title is stored and slugged in composed Unicode form, so a decomposed ä behaves as ä. It is lowercased; ä and å become a and ö becomes o; every run of other characters that are not a to z or 0 to 9 becomes one hyphen; leading and trailing hyphens are removed. A title that leaves nothing, such as `!!!`, is refused `422` keyed `title`, on create and on PATCH.
- **Uniqueness:** a slug is unique within its programme, across current slugs and every earlier slug recorded for the programme, whatever state their references are in. A clash takes the lowest free suffix starting at `-2`. The exception is a rename back to one of the reference's own earlier slugs, which takes that slug back and drops that history entry.
- **Renaming:** changing the title recomputes the slug, in any state. A title that yields the same slug, such as a change of case, writes no history. Otherwise the slug it held enters history. For example, renaming A to B and back to A leaves A current and B reserved in history.
- **Redirects:** every earlier slug of a live reference answers a permanent redirect (`301` or `308`) straight to the current address, in one hop, in all forms: `/references/<old>` to `/references/<current>`, `/fi/references/<old>` to `/fi/references/<current>`, and `/api/references/<old>` and `/api/fi/references/<old>` to their current API addresses. A reference renamed twice redirects from both earlier slugs straight to the current one. The redirect keeps the query string byte for byte. Its `Location` is a root-relative path or an absolute address on `APP_PUBLIC_URL`, whatever `Host` or `X-Forwarded-Host` says. When the reference is not live, every earlier slug answers `404`.

**Enquiries.** Enquiries sent to the public origin belong to `northfall`. Two addresses are the same when they match after trimming spaces and lowercasing.
- A valid enquiry from an address that already has an open enquiry joins it: no row is written and the open record is left exactly as it was, arrival time included.
- Simultaneous valid enquiries from one address with no open enquiry leave exactly one row, and every one of them answers with that row's `id`.
- Deleting an enquiry closes it: it leaves the queue, and a later delete of the same `id` answers `404`. After that, a new enquiry from the same address is a record of its own.
- A refused enquiry writes nothing.

**Sessions.** A token is valid for 28,800 seconds (8 hours) from sign-in on the service clock. Exactly 8 hours after sign-in it is still valid; one second later it answers the `401`.

**Roles and programmes.** The server decides what a request may do from the account behind its token, read from the stored account on every request, never from the request or from anything copied at sign-in. A changed `account.role` or `account.programme_id` applies to the next request under an existing token. A token whose account has been deleted answers `401`. Parallel requests from different accounts never see each other's rows. A request naming a role, programme, account, publication state, ordinal or window outside the endpoint that owns it is answered as though it had named none.

A curator who asks to record a window or delete an enquiry is refused `403`, and nothing changes. The refusal names neither the stored dates nor the role that would have been needed.

A request for another programme's reference, enquiry, preview link or ordinal answers the standard `404` and changes nothing. That holds for reading, editing, renaming, publishing, retiring, recording a window, moving, minting a preview link and deleting an enquiry alike.

**Two languages.** Every public route answers both at its English address and under `/fi`, and both `/fi` and `/fi/` answer the Finnish home page. `/fi/fi/references` and `/fi/desk` answer the Finnish not-found page. A reference may carry a Finnish title and a Finnish body.
- **Finnish body written:** the Finnish detail page shows the Finnish title and the Finnish body in place of the summary, challenge and work, and shows no pending note.
- **Finnish body missing:** the page shows the English title, summary, challenge and work under the pending-translation note.

Notes and figure labels are shown in English on both surfaces. Each document declares its language, `en` or `fi`. Its head carries `<link rel="alternate" hreflang="fi">` on English pages, or `hreflang="en"` on Finnish pages, pointing at the other language's address.

**Language links.** The switch and the alternate keep the raw query string byte for byte, correctly escaped for HTML and never re-encoded, so `?sector=food&x=a%20b&y=%C3%A4` stays exactly that. This holds on every page that shows them, the not-found, refused-preview and outage pages included.

**Language of parts.** Any block in the other language carries its own language marking. On Finnish pages that means the English text under the pending note, the notes and the figure labels. The "Suomi" link is marked `fi` and the "English" link is marked `en`.

**Dates.** Note dates read `14 September 2026` on English pages and `14.9.2026` on Finnish pages, with no leading zero. Worked out from `published_on`, they are never shifted by a time zone.

**Finnish order.** Non-live desk rows sort by title in Finnish alphabetical order: a to z, then å, ä, ö, ignoring case, ties by slug, whatever the database's collation. Other characters sort before a, by code point. For example, the titles Zinc, abc, Åland, Ämmä, Öljy and Ankkuri sort as abc, Ankkuri, Zinc, Åland, Ämmä, Öljy.

**Unknown addresses.** An address that matches no page route, such as `/no-such-address-here`, `/fi/no-such-address-here`, `/references/%00` or `/references/%ED%A0%80`, answers `404` with the product's not-found page in that language. The page shows the wordmark, the not-found heading, and links to the home route and the index. It is never a redirect.

### Services (DP-02, DP-03, DP-24, DP-62, DP-63)

The one backing service is Postgres at `DATABASE_URL`. Every record this brief names is stored there and survives a restart. The app creates its schema idempotently each time it starts, and applies the seed once per database, even with several server workers starting together. A restart never duplicates the seed, never restores a changed or removed record and never resets the service clock.

**Data model.** Nine entities are stored, each in its own table: `programme`, `account`, `reference_entry`, `figure`, `note`, `enquiry`, `preview_link`, `slug_redirect` and `service_clock`. Every table has an integer `id` key. The tenant key is the column `programme_id`, which holds `programme.id`. A key to a reference is the column `reference_id`, which holds `reference_entry.id`. The column names below are literal, and you may add columns of your own.

- `programme`: `name`, `slug`, `default_locale`.
- `account`: `email`, `password_hash` (never the clear password), `role` (`curator` or `steward`), `programme_id`.
- `reference_entry`: `programme_id`, `slug`, `ordinal` (null when not live), `sector`, `customer`, `title`, `summary`, `challenge`, `work`, `title_fi`, `body_fi`, `published`, `retired_at`, `version`, `clearance_from`, `clearance_until`, `quote`, `quote_speaker`, `quote_role`. `published` is true when the state is live or withheld, and false when it is draft or retired.
- `figure`: `reference_id`, `label`, `value`, `position` (an integer counting from 1). Editing `figures` replaces the reference's figures as a whole, with positions 1 to n in list order, all belonging to the edited reference.
- `note`: `programme_id`, `slug`, `title`, `preview`, `body`, `published_on` (null for a draft).
- `enquiry`: `programme_id`, `email`, `phone`, `reference` (the text slug of the reference of interest, or null), `created_at`, `agreed`, `open`.
- `preview_link`: `token`, `reference_id`, `expires_at`.
- `slug_redirect`: `programme_id`, `slug` (the earlier slug), `reference_id`.
- `service_clock`: `offset_seconds` (an integer), exactly one row.

How desk sessions are stored is up to you, within Postgres, as long as authority comes from the stored account.

If Postgres stops answering, the behaviour and copy are as given in Server boundary and Feedback states.

### Seed data (DP-02, DP-06, DP-15, DP-57)

Every seeded person, programme and business is invented. On first boot the seed is in place, with nothing else in any table.

**Service clock.** One row, `offset_seconds` 0.

**Programmes.**
- `northfall`: named "Northfall Reference Programme", default locale `en`.
- `westhall`: named "Westhall Reference Programme", default locale `en`.

**Accounts.** All three use the password `deku-demo-pw-2026`:
- `curator@example.com`: curator in `northfall`.
- `steward@example.com`: steward in `northfall`.
- `curator.westhall@example.com`: curator in `westhall`.

**References.** Each title reads as its slug in words, with a capital first letter (for example, `harbour-crane-retrofit` is "Harbour crane retrofit"). Every reference starts at `version` 1 with `retired_at` null.

| Programme | Slug | Sector | Customer | Published | Window | Ordinal |
|---|---|---|---|---|---|---|
| northfall | `harbour-crane-retrofit` | `ports` | Kiela Terminals | yes | 2026-01-01 to 2027-12-31 | 1 |
| northfall | `dairy-line-rebuild` | `food` | Vuono Dairy | yes | 2026-01-01 to 2027-12-31 | 2 |
| northfall | `paper-mill-drive-swap` | `pulp` | Aspen Mills | yes | 2026-01-01 to 2027-12-31 | 3 |
| northfall | `rail-depot-signalling` | `rail` | Northline Rail | yes | 2025-01-01 to 2026-01-31 (ended) | none |
| northfall | `quarry-conveyor-upgrade` | `mining` | Stonebeck Quarry | no (draft) | none | none |
| westhall | `cold-store-automation` | `cold-chain` | Pakkas Logistics | yes | 2026-01-01 to 2027-12-31 | 1 |

**Finnish text.** Only `harbour-crane-retrofit` has Finnish text: the title "Satamanosturin modernisointi" and a Finnish body of at least two paragraphs that you write. No other reference has a Finnish title or body.

**Quote.** Only `paper-mill-drive-swap` carries one. The text is "We switched forty-eight drives during two planned shutdowns and lost no production day to it.", the speaker is Hanna Lehto and the role is Maintenance manager, Aspen Mills.

**Figures.** These are given as label and value, in position order:

| Reference | 1 | 2 | 3 |
|---|---|---|---|
| `harbour-crane-retrofit` | Crane availability / 99.2 % | Retrofit downtime / 11 days | Energy per container move / -18 % |
| `dairy-line-rebuild` | Line output / +34 % | Changeover time / 22 min | Unplanned stops per month / 3 |
| `paper-mill-drive-swap` | Drive energy saved / 2.1 GWh a year | Payback / 26 months | Drives replaced / 48 |
| `rail-depot-signalling` | Points converted / 64 | Depot throughput / +12 % | Commissioning nights / 9 |
| `cold-store-automation` | Pallet moves per hour / 410 | Picking errors / -61 % | Store temperature / -25 °C |

The draft `quarry-conveyor-upgrade` has no figures. Each reference's summary, challenge and work are at least one paragraph of your own writing, in the programme's voice.

**Notes** (all in `northfall`), each with a body of at least one paragraph that you write:

| Slug | Title | Published on | Preview |
|---|---|---|---|
| `what-a-clearance-covers` | What a clearance covers | 2026-09-14 | A customer clears the story, its figures and its quote together. |
| `why-we-number-the-library` | Why we number the library | 2026-06-02 | Each cleared reference takes the next number, and the numbers never skip. |
| `translating-the-library` | Translating the library | none (draft) | Finnish versions arrive one reference at a time. |

**Enquiries.** Both are open and agreed:
- `northfall`: from `prospect@example.com`, reference `dairy-line-rebuild`, no telephone, arrived 2026-10-01 09:00 Helsinki time.
- `westhall`: from `cold.buyer@example.com`, reference `cold-store-automation`, no telephone, arrived 2026-10-02 10:00 Helsinki time.

No preview links and no slug history exist at start.

**Reference managers** on `/contact`. This is page content, not stored records:

| Name | Role | Address | Line |
|---|---|---|---|
| Aino Rask | Reference manager, ports and logistics | aino.rask@example.com | +358 40 000 0101 |
| Mikael Söderholm | Reference manager, food and beverage | mikael.soderholm@example.com | +358 40 000 0102 |
| Leena Varjo | Reference manager, pulp and paper | leena.varjo@example.com | +358 40 000 0103 |
| Tomas Brandt | Reference manager, rail | tomas.brandt@example.com | +358 40 000 0104 |
| Iiris Kallio | Reference manager, mining and minerals | iiris.kallio@example.com | +358 40 000 0105 |
| Joonas Hirvi | Head of the reference programme | joonas.hirvi@example.com | +358 40 000 0106 |

## Technical requirements

### Deployment (DP-01, DP-63, IF-01, IF-02, IF-08)

Python 3.12 and Node 22 are available. The app is installed and run as an unprivileged user: dependencies go into a `.venv` inside `/app`, and the manifest calls its tools by path (`.venv/bin/<tool>`) or as `python -m <tool>`. The app root holds `/app/run.json` with string `install`, `build` and `serve` commands and the schema marker. For example:

```json
{"_schema":"run-manifest-v1","install":"python -m venv .venv && .venv/bin/pip install -r requirements.txt","build":"","serve":".venv/bin/gunicorn --bind 0.0.0.0:${APP_PUBLIC_PORT:-4173} wsgi:app"}
```

Use commands that suit your source.
- `serve` stays in the foreground and runs a production server, never a development server. It may run several workers.
- The app binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when it is set, and reads the public origin from `APP_PUBLIC_URL`.
- Pages and the API share that origin, with the API under `/api`. `GET /api/health` answers as API describes.
- The app needs no manual step: it creates its schema and seed on start.

`/app/USER_README.md` lists each seeded desk account as an `Email:` line followed by a `Password:` line:

```
Email: curator@example.com
Password: deku-demo-pw-2026
Role: curator in northfall

Email: steward@example.com
Password: deku-demo-pw-2026
Role: steward in northfall

Email: curator.westhall@example.com
Password: deku-demo-pw-2026
Role: curator in westhall
```

### Configuration and secrets (DP-03, DP-24)

The app reads three settings at start and from nowhere else:
- the database connection from `DATABASE_URL`;
- the port from `APP_PUBLIC_PORT`;
- the public origin from `APP_PUBLIC_URL`.

No credential is hard-coded in source or sent to the browser. Passwords are stored as salted one-way hashes. Use only the Postgres service. No other datastore, no persistent volumes, no fixed container names and no custom networks.

### Server boundary (DP-04, DP-05, DP-14, DP-56, DP-63)

**One origin.** The host at `APP_PUBLIC_URL` serves both the pages and the API. The browser contacts no other origin to render any page. The server sends no headers that open the API to other origins.

**Nothing extra is served.**
- No framework or debug surface exists. `/docs`, `/redoc`, `/openapi.json`, `/swagger`, `/admin`, `/api/docs`, `/api/openapi.json`, `/api/schema` and `/api/debug` each answer `404`: the JSON body for `/api` paths, the not-found page for the rest.
- The product has no `/api/auth/signup`, `/api/signup`, `/api/search`, `/api/checkout`, `/api/comments`, `/api/notes/comments` or `/api/reactions`; each answers the JSON `404`.
- The server never serves source files, the run manifest, dependency lists, environment files or version-control data. Any such path answers the not-found page.
- Page routes accept `GET` and `HEAD`. Any other method answers `405` with `Allow: GET, HEAD`.

**Media.** This is a zero-asset build: no video and no `<video>` element. The wordmark is type set in the display serif with a layered highlight, built in the page. The two typefaces are a transitional serif and a grotesque sans under the SIL Open Font License, served from this origin. Portraits and installation photographs are images you produce, or images whose licence permits reuse, all served from this origin. Decorative objects are drawn as geometry in the icon family.

**Client-side state.** The only client-side state on public routes is one marker recording that the cookie notice has been answered. It holds the answer and never an identity. The desk keeps its bearer token for the tab session.

**Postgres unreachable.**
- **At boot:** the server starts and keeps retrying. `GET /api/health` answers the starting `503` until Postgres answers, then the schema and seed are applied, and the app serves with no restart.
- **After boot:** within 5 seconds of Postgres stopping, and within 5 seconds of each request:
  - `GET /api/health` answers the starting `503`;
  - every other `/api` route that needs the database answers `503` with `{"message":"The reference desk is unavailable right now"}`;
  - every public page, including `/programme`, `/story` and `/contact`, answers `503` with a page carrying that sentence in the page's language (the Finnish sentence is in Feedback states).
- **What keeps working:** unknown `/api` paths, `405`s, `413`s and unknown page addresses keep their usual answers. `/desk` itself keeps answering `200`, and its calls report the desk's unreachable message.
- **Recovery:** after Postgres returns, the first request after health reports ok succeeds, with no app restart and no failed request left over from an old connection.
- **Always:** no refusal or error page ever contains a stack trace, SQL, a file path or a library name.

### Browser support and performance (DP-09, DP-11, DP-43..DP-47)

Support current Chromium at 1280 by 800, 768 by 1024 and 375 by 812, plus the 320-pixel reflow width.
- The first screen of each public route renders without waiting on a script, and the index and its filter are rendered on the server.
- On the seeded data, each public page answers within one second and is usable within two seconds.
- Images are served at the size they are shown and carry explicit dimensions, so nothing shifts as they arrive. Images below the first screen load as they approach the window.
- No third-party script runs.
- Each reference detail page carries a page title, a description drawn from its summary, and a social preview image served from this origin.

## Working rules

- **IF-01** — `/app/run.json` exists with `"_schema":"run-manifest-v1"`, non-empty string `install` and `serve` commands and a string `build` command, so the app can be brought up from cold on a machine that has only `/app`.
- **IF-02** — `/app/USER_README.md` lists every seeded desk account as an `Email:` line followed by its `Password:` line, exactly as in Deployment.
- **IF-03** — `/app/THIRD_PARTY_NOTICES.md` names every shipped package and font with its licence; shipped packages means the production dependency tree (the packages your `install` command installs for Python, and `npm ls --omit=dev --all --json` if any npm packages ship).
- **IF-04** — Every shipped package carries one of MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0, MPL-2.0 or LGPL-3.0, and every shipped font carries the SIL Open Font License 1.1.
- **IF-05** — The app stores data only in the Postgres database at `DATABASE_URL`: no SQLite file, no other database server, no cache server.
- **IF-06** — `/app/IMAGE_MANIFEST.md` lists every image file the app serves, with its origin and its licence.
- **IF-07** — The provided development service configuration for Postgres is left unchanged.
- **IF-08** — Python dependencies install into a `.venv` inside `/app`, and the manifest calls tools by `.venv/bin/<tool>` or `python -m <tool>`.

## Engineering standards

- The code reads as idiomatic Python, and its names use the domain terms of this brief: reference, clearance window, live set, ordinal, preview link, enquiry, curator, steward, programme.
- Each domain rule is decided in exactly one place and used by every surface that needs it: the reading of now, the live-set rule with its Helsinki date, the reference state, the ordinal run and its rollover, the slug derivation, the role check, the clearance void and the editable-field list.
- The acting account, its role and its programme come from the stored account behind the session, never from fields in the request.
- Every refusal uses one of the two JSON shapes in API, produced in one place, and no framework default error body reaches a client.
- The Finnish wording lives in one published table of strings, and the desk's focus target for each action is decided in one place.
- There is no dead, commented-out or unreachable code, and no defensive check for states the data model cannot hold.
- There is no abstraction with a single implementation, and no feature beyond this brief.
