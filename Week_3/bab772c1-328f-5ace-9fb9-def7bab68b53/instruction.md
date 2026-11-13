# Grazing Angle Instruments Perilune Ledger

Perilune Ledger is a web console for one author who rebuilds lunar flights from telemetry. Space historians and amateur radio trackers upload raw captures to a mission. Each capture is a "pass": an S-band Doppler log, an ephemeris dump or a transcribed public record.

What the console does:
- It stores each pass byte for byte and queues it for parsing, within the storage quota of the author's Archive plan.
- It draws the parsed pass as a ground track on an orthographic lunar disc.
- It replays the track at 1×, 10× or 60×, interpolating between samples exactly as the server does.
- It compares the track with a reference ephemeris fetched from a third-party service.
- The author inspects any moment with the Track loupe, pins flight events to mission elapsed time (MET), keeps private working notes and marks landmarks.
- Every change to a mission is written to a hash-chained audit log that anyone holding the log can verify.
- The author renders a mission dossier as a PDF and publishes a read-only replay link. The link is rate-limited and expires.
- Club websites subscribe to a mission and receive one signed webhook per change. The author's phone receives one push alert per parse outcome.
- Readers open the replay link on a phone or laptop. While the page is open, they see the author's changes arrive. They check values against the readout and download the original capture, the event list and the dossier. The author sees how many readers have the page open.

The server uses ten services:
- Postgres: records, the outbox, the audit log and change notices between instances
- S3-compatible object storage (MinIO): original captures
- Meilisearch: transcript search
- RabbitMQ: parse jobs and webhook sends
- a third-party ephemeris HTTP API, which WireMock stands in for in this build
- Gotenberg: PDF rendering
- Valkey: the share rate limit and the live reader count
- Kill Bill: the Archive plan, its invoices and the author's billing account
- Svix: signed outbound webhooks to subscribers
- ntfy: push alerts to the author

Out of scope:
- user accounts and sign-in (the author console is one person's tool and has no login)
- collecting payments (Kill Bill invoices the plan; no card or payment method is captured)
- reader comments
- live tracking of a spacecraft in flight
- orbit propagation or fitting
- audio playback
- any datastore, broker, cache or external service other than these ten

## Problem and users

Since Artemis II, independent people have been recording lunar spacecraft and publishing what they capture. Amateur radio operators log S-band Doppler. Satellite groups keep years of passes. Historians rebuild Apollo and commercial-lander flights second by second. None of them has a tool that turns a raw capture into a replay a reader can check. They combine spreadsheets, ephemeris dumps, transcript text files and screen-recorded plots, and that costs them in several ways:
- Station logs write times as GMT day of year, and ephemeris services answer in kilometres and Unix milliseconds, so authors convert every value by hand.
- Apollo-era nautical miles and feet per second are also converted by hand, so one altitude appears as three slightly different numbers in one write-up.
- Screen-recorded replays show interpolated positions nobody can reproduce from the file.
- File names arrive with dashes and symbols that tools mangle.
- When a reader asks for the original data, it is usually lost, and nobody can show the replay was not quietly edited after publication.
- Captures sent over a flaky home-station link arrive twice or not at all.
- Club websites that mirror a replay learn about changes late, twice or never.

Read-only sites replay a few famous missions but do not accept your own data. Mission-control frameworks accept any data but need a developer and a server team. Authors lose evenings reconciling numbers. They lose credibility when a reader finds that a plotted perilune (the lowest point of a lunar orbit) does not match its file, or that a circulated PDF disagrees with the screen.

Users:
- **Replay author** (daily). The author:
  - uploads a captured or public pass and checks it on the lunar track against a reference ephemeris
  - types times exactly as station logs print them
  - plays the pass back at 1×, 10× or 60×
  - pins flight events and air-to-ground lines to MET, keeps private notes, marks landmarks and chooses display units
  - renders a dossier and verifies the mission's audit log
  - publishes a read-only replay link, sets its expiry, watches how many readers have it open, and withdraws it
  - registers club websites as webhook subscribers and gets a push alert when a pass parses or is rejected
  - keeps their archive within an Archive plan quota and changes plan when it fills
- **Replay reader** (occasional). The reader:
  - opens a share link on a phone or laptop, inspects any moment with the loupe and plays the pass back
  - sees the author's changes arrive without reloading
  - searches the transcript and sees who spoke how often
  - downloads the original capture (whole or in part), the event list and the dossier to check the numbers
  - sends colleagues a link to the exact view

## Journeys

1. **First pass on a new mission, over a flaky link.**
   - The author starts on the Missions page, which lists the seeded mission and shows the Archive plan region on the free plan.
   - They create a mission and type its epoch in GMT day-of-year form. The console opens with the epoch in that form and the empty-mission heading.
   - They choose a capture whose name contains an en dash and a check mark. The first attempt drops with no answer, and the console resends it under the same request key.
   - The passes list shows one pass under its exact name. It moves from Uploading to Stored once storage confirms the checksum, then to Parsed with its sample count once the parse queue has run it. Each step is announced once.
   - The ground track appears on the disc and the perilune appears in the header. The author's push topic receives exactly one "pass parsed" alert.
2. **A capture with a bad line, and one that breaks the parser.**
   - The author uploads an ephemeris dump whose third line is a 2,000-byte comment. The pass is stored, then shows as rejected at line 3 with the reason, the rejection is announced, and one "pass rejected" push alert arrives.
   - A second capture contains a sample at the Moon's centre. The queue retries it, and then it shows as rejected because the parser stopped, with one urgent push alert.
   - The author downloads the stored originals, deletes the rejected passes using only the keyboard, and uploads a corrected file.
3. **Checking a moment, playing it back and pinning an event.**
   - On the seeded mission, the author tabs to the track and the lens grows at the current sample.
   - Arrow keys step one sample, and Shift with an arrow steps 60. The readout plate and the oversized MET readout follow, the matching transcript line becomes current, and the address gains `t`.
   - The author types a GMT time from the station log into `Go to GMT`, and the lens jumps there.
   - They choose 10× and press Play. The readout runs through interpolated positions between samples, then Pause leaves the lens on the sample just played.
   - Enter on the track opens the Pin event dialog with the MET filled in. The author corrects the MET, types a title and a private note, and presses Save event twice by accident.
   - Exactly one event appears, at the sample it snapped to. It is announced once, and focus returns to the track.
4. **Units, landmarks and a reference on a tablet.**
   - The author opens the Channels drawer by keyboard, chooses nmi and ft/s, and closes it. The plate and the Events table show the converted values. As the author tabs down the page, no focused control is ever hidden under the pinned MET band.
   - The author adds a landing site with coordinates typed with hemisphere letters. It appears in the list, on the disc and as a range line on the plate. A second landmark whose name differs only by case is refused. The author removes a mistyped landmark with its Remove button.
   - The author types the reference target. The reference becomes ready, and the plate's `ΔR` line shows how far the capture sits from the reference at each sample. Later they clear the target, and the `ΔR` line disappears.
5. **Searching while working.**
   - The author types `perilune` quickly, and the count for the final text is announced. The Speakers list shows who spoke and how often.
   - With the phrase still in the box, they pin an event whose title contains that word. The results grow by one in place, and the new count is announced.
   - Picking a result moves the lens, the readout, the current line and the address to that moment.
   - Deleting the pass later empties the results in place.
6. **A full archive, a plan upgrade and removing a pass.**
   - The author's free plan is nearly full. An upload that would pass the quota is refused with the quota copy, naming the bytes used and the quota.
   - On the Missions page the author chooses the 1 GiB plan. Billing invoices it, and the region shows the monthly price, the larger quota, the next invoice date and the balance billing reports.
   - Retrying the upload now succeeds.
   - Later the author deletes a pass and confirms in the dialog. Focus lands on the passes list. The pass's track, lines, events, search entries, pending search writes and stored file are gone everywhere, including the share page, and the bytes used fall.
   - The mission's audit log gains one deletion entry, every earlier entry is unchanged, and the chain still verifies.
7. **From capture to checked replay, across two instances.**
   - The author registers a club website as a subscriber and creates a share link with a day-of-year expiry.
   - A reader in another time zone opens it on a phone, served by a different app instance. The page opens in the author's saved units, and the author's Share region shows one reader.
   - The reader:
     - goes to a GMT time and reads the plate, including `ΔR`
     - switches to km
     - fetches the first bytes of the original capture, then the whole event list and the dossier

     The CSV row and the dossier's perilune lines match the plate.
   - The author pins another event. It appears on the reader's page within seconds, without a reload, and the club website receives one signed webhook for it. The private note appears nowhere on the reader side or in the webhook.
   - The reader closes the page, and the reader count drops.
   - The author revokes the link. The reader's page becomes the withdrawn page, and the club receives one revocation webhook. An embargoed link's page becomes the expired page at its expiry.
8. **Working through outages.**
   - **Capture storage goes down.** Both consoles show the storage banner. Uploads, deletions and capture downloads are refused with the published copy, and the replay keeps playing. A refused deletion leaves everything as it was, and open readers and subscribers see no change. When storage returns, the banner clears by itself, and retrying the refused upload under the same key works without a restart.
   - **Search goes down.** It behaves the same way. Lines, titles and landmark edits saved during the outage stay intact. The lines and titles become searchable later, except those of a pass deleted in the meantime.
   - **The parse queue goes down.** Uploads are stored and wait, and the queue banner shows. Once the queue returns, they parse in order.
   - **The PDF renderer goes down.** Dossier downloads are refused with the published copy.
   - **The cache goes down.** Share links keep working, without a rate limit.
   - **Billing goes down.** Plan changes are refused with the published copy, and uploads keep the last confirmed quota.
   - **Webhooks go down.** Changes still save. Each one reaches subscribers exactly once after the webhook service returns.
   - **Push alerts go down.** Parse outcomes are unchanged, and the missed alerts are not sent later.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Missions with an epoch** Create a mission with a name and an ISO 8601 UTC epoch through the API, rejecting bad input with the field errors in API.
- **DP-02 — Empty mission console** A mission with no parsed samples shows the empty-mission heading and line from Feedback states in place of the lunar disc, on the author console and on the share page.
- **DP-03 — Storage-confirmed upload** An uploaded capture becomes `stored` only after object storage confirms the object and its SHA-256 matches the declared checksum, and otherwise no pass, object or kept request key remains, as qualified in Business rules.
- **DP-04 — Duplicate, empty and oversized captures** Reject a second live copy of the same bytes under a different request key, an empty body, a wrong content type and a body over the size limit with the statuses in API.
- **DP-05 — Upload announcements** Every upload step (uploading, stored, parsed, rejected with its line number, refused) is announced once in the `Upload status` live region, however many attempts the console makes, with the exact copy in Feedback states.
- **DP-06 — Upload a pass journey** The author creates a mission on the Missions page, picks a capture file, watches the pass go Uploading, Stored and Parsed in the passes list, and sees its ground track drawn on the disc.
- **DP-07 — Capture line format** Parse captures under the published line format, including its per-line byte limit, field lengths and byte-order-mark rule, ignoring comment and blank lines but counting them in line numbers.
- **DP-08 — Parse outcome** A stored pass becomes `parsed` only when every line parses and its search documents are confirmed or recorded as pending, and otherwise becomes `rejected` with the first bad line number and its reason code, within the parse budget in Business rules.
- **DP-09 — Derived values** Latitude, longitude, altitude above the mean lunar radius, speed and the mission perilune are computed once on the server from SI samples and never change when display units change.
- **DP-10 — Mission elapsed time** Every sample, transcript line and event carries a server-computed MET in seconds and its label, with pre-epoch times labelled with a T- prefix.
- **DP-11 — Loupe lens and readout** On pointer enter or touch start with a visible sample within 24 CSS pixels, or on keyboard focus, the lens grows to 160 by 160 CSS pixels at the nearest such sample (the current sample for keyboard focus), stays closed when no sample is that close, and shows the track magnified with a crosshair, while the readout plate shows that sample's lines as listed in Public screens and controls.
- **DP-12 — Keyboard stepping** The track canvas is a slider named `Track loupe` whose arrow, Shift+arrow, Home and End keys move the lens by one sample, by 60 samples or to the ends, with value text naming MET and altitude.
- **DP-13 — Moment links** Releasing the pointer, lifting a finger, ending a key step, going to a GMT time, pausing or ending playback, or picking a line or result writes `t=<MET seconds>` to the address while keeping its other parameters, and opening such an address places the lens on the sample at or before that MET.
- **DP-14 — Current transcript line** The transcript line at or before the lens MET becomes the current line and scrolls into view, and picking any transcript line moves the lens to the sample at or before it.
- **DP-15 — Touch and reduced motion** On a phone one finger drags the lens along the track without scrolling the page, and with reduced motion the lens appears at full size and numerals change in place while every other loupe behaviour stays the same.
- **DP-16 — Unit conversion and rounding** Altitude, speed, landmark range, residual and position are displayed under the exact factors and half-away-from-zero rounding of exact half-way values, identically on the readout plate, the Events table, the share page, the event list download and the dossier.
- **DP-17 — Saved display units** The author's distance and speed unit choice is saved on the mission and becomes the share page's starting units unless the share address names others, while a reader's choice changes only their own view and address.
- **DP-18 — Channel drawer** Below 1280 pixels wide the channel rail is a drawer, and while it is closed none of its radios or checkboxes is visible, focusable or exposed to assistive technology.
- **DP-19 — Switch units journey** The author opens the channel drawer on a tablet and switches to nmi and ft/s, and the readout, the Events table and a freshly opened share page all show the same converted values.
- **DP-20 — Pin events** Pinning an event requires a request key and a MET in whole seconds, snaps the event to the sample at or before that MET, and stores a public title and an optional private note, as qualified in API.
- **DP-21 — Pin an event by keyboard** Pressing Enter on the track loupe opens the `Pin event` dialog with focus in Title, Tab wraps inside it, Escape cancels it, one opening of the dialog creates at most one event, and focus returns to the loupe after saving or cancelling.
- **DP-22 — Private notes stay private** A private note appears only in the author console's Note column and Pin event dialog, in author event responses and in the author dossier, never in any share, stream, search, CSV, share dossier, webhook, push alert, audit, title, attribute, storage or header surface listed in Business rules.
- **DP-23 — Mission-scoped transcript search** Search returns only the mission's transcript lines and public event titles with their MET, never another mission's items, a deleted pass's lines or a landmark.
- **DP-24 — Latest query wins** The results shown always belong to the text now in the search box, even when an earlier query or refresh answers later.
- **DP-25 — Search announcements** The `Search status` live region announces the result count for the current query once per search or refresh, with the exact copy in Feedback states.
- **DP-26 — Jump from a search result** The author types a phrase and picks a result, and the lens, readout, current transcript line and address move to that moment.
- **DP-27 — Deleted means gone** After a pass is deleted, its samples, transcript lines, events, index entries, pending search writes and stored object are gone from every author view, share view, search and download, its direct URLs answer as gone, and catching up on pending search writes never brings any of them back.
- **DP-28 — All-or-nothing delete** A pass deletion that cannot reach storage, or whose removal from the index is not confirmed, removes nothing, and of simultaneous deletions of one pass exactly one succeeds.
- **DP-29 — Keyboard delete confirmation** Deleting a pass asks for confirmation in the `Delete pass` dialog, which works fully from the keyboard and returns focus to the passes list after deleting.
- **DP-30 — Share link capability** A mission has at most one active unguessable share link, replacing the link kills the old one, and revoking it makes the very next request with it fail.
- **DP-31 — Read-only replay page** The share page and its API answer only reads, show only parsed passes and public data, are never cached, and refuse every write.
- **DP-32 — Reader console layouts** The replay console shows one column at 375 pixels wide, the track beside the readout at 768, and the channel rail, track and transcript side by side at 1280 and wider.
- **DP-33 — Publish and read journey** The author creates a share link with a typed expiry, and a reader opens it on a phone, steps the loupe, searches the transcript and downloads the event list; after the author revokes the link, the reader's next request shows the withdrawn page.
- **DP-34 — Original capture download** Downloading a capture from the share page or the author console returns the exact uploaded bytes, byte-order mark and comment lines included.
- **DP-35 — Event list download** The share page's event list download is an RFC 4180 CSV of public events in the reader's current units whose text cells starting with a formula character are neutralised before quoting, as qualified in API.
- **DP-36 — Capture storage outage** With capture storage unreachable, uploads, deletions and capture downloads on both consoles answer the storage outage status and show the published copy, while the replay still plays.
- **DP-37 — Storage recovery without restart** When capture storage answers again, the next upload (including a retry under a refused request's key) succeeds without restarting the app and the storage banner clears by itself.
- **DP-38 — Search outage** With transcript search unreachable, searches and deletions answer the search outage status and the console shows the search banner, while uploads still parse and pins still save.
- **DP-39 — Search recovery and catch-up** When search answers again, the next search succeeds without a restart, the search banner clears by itself, and lines and titles saved during the outage become searchable, as qualified in Services.
- **DP-40 — Health and boot** The app answers its health check and serves the consoles even when storage, search, the parse queue, the cache, the PDF renderer, the ephemeris service, billing, webhooks or push alerts are unreachable at start.
- **DP-41 — Server boundary** The server answers only same-origin app routes, enforces its body limits, answers every error with exactly the keys published for it under one precedence order, and never serves source files or credentials.
- **DP-42 — Accessible controls** Every public control has its published role and name, is at least 44 by 44 CSS pixels, shows a visible focus mark, and the consoles meet WCAG 2.2 Level AA.
- **DP-43 — Lunar disc and ground track** The centre pane draws a procedural orthographic lunar disc with a graticule, the ground track, event pins, landmark marks and a perilune mark, legible at every viewport.
- **DP-44 — Instrument console look** The console reads as a measured, dusty, exact instrument: warm grey ground, hairline rules, tabular mono numerals, an oversized MET readout, and no shadows, rounded cards or pure white.
- **DP-45 — Real providers and environment credentials** Pass states, parsing, downloads, search, reference vectors, dossiers, rate limits, reader counts, live share updates, plans, webhooks and push alerts come from real calls to the ten services using credentials and URLs read from the environment, never from hard-coded values or secrets held in the browser.
- **DP-46 — Retry-safe uploads** An upload requires an `Idempotency-Key`, and a retry under the same key replays the first answer without creating a second pass, object or search document, as qualified in Business rules.
- **DP-47 — Retry-safe event pins** A pin requires an `Idempotency-Key`, and a retry or double press under the same key returns the first event without creating another, as qualified in Business rules.
- **DP-48 — Bounded parsing** An over-long line, a 50,001st sample or an over-long field rejects the pass at its exact line, and every capture up to the size limit is settled within the parse budget.
- **DP-49 — Search follows every change** Pins, parsed passes and deletions answer only after the search engine confirms their writes or records them as pending, and a console with a query in its search box re-runs it in place after each change named in Interactions.
- **DP-50 — Expiring share links** Every share link carries a UTC expiry, by default 30 days after creation, at and after which every share route answers the expired status and an open reader page switches to the expired page, as qualified in Business rules.
- **DP-51 — Console state survives its timers** Status checks, pass checks, banner changes, pushed updates, reader count changes and track reloads never close a dialog or drawer, move focus, clear the search or a dialog draft, stop playback, or move the lens off its MET, units or address, except where a track reload is said to pause playback.
- **DP-52 — Server playback frames** The frames API returns the frames on the requested MET grid at 1, 5, 10 or 25 frames per second, each computed by cubic Hermite interpolation between the bracketing samples or held across gaps over 600 seconds, as qualified in API and Business rules.
- **DP-53 — Play the pass** Play replays the track from the lens sample at 1×, 10× or 60×, timed only by the page's monotonic clock, and every value the readout shows equals the server frame for the playback MET, while reduced motion shows samples without interpolation, as qualified in Interactions.
- **DP-54 — Mission audit chain** Every mission change appends one audit entry in its own transaction, hash-chained over RFC 8785 canonical JSON and never holding a note, which the audit and verify routes return and check and the share routes never expose.
- **DP-55 — Reader view in the address** The share page keeps its units, and both consoles keep their search query and moment, in the address under the WHATWG form-urlencoded serialization, so opening that address restores them.
- **DP-56 — Day-of-year time entry** The `Epoch (GMT)` and `Link expiry (GMT)` fields accept only GMT day-of-year times, refuse anything else in the browser with the published field error and no request, and send the matching ISO instant whatever the browser's time zone.
- **DP-57 — Instants shown in day-of-year form** The mission epoch in the console header, the share link expiry in the Share region and on the share page, and the readout plate's GMT line show instants in GMT day-of-year form, while every API response keeps ISO instants.
- **DP-58 — Go to GMT** Entering a GMT day-of-year time in `Go to GMT` on either console moves the lens to the sample at or before that instant, updating the slider, readout and moment link exactly as a key step does.
- **DP-59 — Pin at a typed MET** The author types a MET label in the Pin event dialog's MET field, the console sends it as whole seconds, and the Events table, share page and API show the event at the sample it snapped to.
- **DP-60 — Landmark records** The API creates, lists and removes up to five named landmarks per mission in signed decimal degrees, refusing bad names, out-of-range or over-precise coordinates and a sixth landmark with the answers in API.
- **DP-61 — Landmark coordinate entry** The Latitude and Longitude fields accept decimal degrees with a hemisphere letter or a sign (ASCII hyphen or the Unicode minus sign), refuse anything else in the browser with the published field errors, and send signed decimal degrees.
- **DP-62 — Landmark ranges and list** Both consoles list the mission's landmarks with formatted coordinates, draw them on the disc, and show one `Range to <name>` readout line per landmark with the great-circle surface distance in the current distance unit.
- **DP-63 — Mark a landmark journey** The author adds a landmark by typing its name and coordinates, sees it in the list, on the disc and in the readout, and removes it with its `Remove <name>` button from the keyboard.
- **DP-64 — Mission change stream** Every share link offers an event stream that sends one `mission-changed` event per mission change version, with the version as its event id, across every app instance sharing the database, replays missed versions in order on reconnection with `Last-Event-ID`, and refuses revoked or expired links.
- **DP-65 — Live reader page** An open share page shows the author's pinned events, parsed or deleted passes, landmark and reference changes, and the withdrawn page after a revocation, within 5 seconds and without a reload, whichever instance each of them uses.
- **DP-66 — Exact pointer picking** Pointer and touch picks on the disc, including the pick that opens the lens, select the nearest visible sample whose orthographic projection lies within 24 CSS pixels of the pointer, at any device pixel ratio, open or move nothing when none is that close, and centre the lens on that sample's projected point.
- **DP-67 — Focused controls stay uncovered** Below 1280 pixels the MET band stays pinned at the top and the Events table scrolls inside its own region, and at every viewport no focused or scrolled-to control is partly covered by the band, a drawer, a dialog or the readout plate, except that at 1280 and wider the Track loupe slider is exempt from the plate.
- **DP-68 — Refused changes leave no trace** A change refused for an outage leaves every row, object, index document, landmark, audit entry and the mission change version untouched and sends no stream message or webhook, while landmark edits and pins still succeed during a search outage.
- **DP-69 — Author-to-reader replay journey** An author creates a mission, uploads, pins, marks a landmark, sets a reference, switches units and shares on one instance, and a reader on another instance in another time zone checks the same values including the residual, downloads the capture and dossier, appears in the author's reader count, sees a live change and then the withdrawn page.
- **DP-70 — Verifiable, conditional and range downloads** Every capture download carries a `Repr-Digest` of the full stored representation, every capture and event list download carries a strong `ETag`, HEAD on those routes answers as GET without a body, and capture downloads honour RFC 9110 conditional and single byte-range requests, with the dossier exempt from ETag and Content-Length equality between HEAD and GET, as qualified in API.
- **DP-71 — UTF-8 capture names** Capture filenames travel percent-encoded as UTF-8, are stored NFC-normalised, appear decoded everywhere, and download with RFC 6266 and RFC 8187 `Content-Disposition` parameters.
- **DP-72 — Strict JSON in and out** JSON request bodies must be I-JSON, so duplicate member names, unpaired surrogate escapes and integers beyond 2^53 - 1 in magnitude answer `invalid_json`, and every integer in every JSON response is a JSON number, never a string.
- **DP-73 — Speaker summary** Both consoles list each transcript speaker with its line count, ordered by count and then by code point, treating names such as `__proto__` and `constructor` as ordinary text.
- **DP-74 — Mission edits as merge patches** Mission edits are RFC 7396 JSON Merge Patch documents in which an absent member stays unchanged and `null` clears the reference target, and the console sends only the members that changed.
- **DP-75 — Caseless landmark names** Landmark names are unique per mission under Unicode canonical caseless matching with full case folding.
- **DP-76 — Forced colours on the disc** With forced colours active, the disc's track, lens, crosshair, pins and landmark marks are drawn in the current system colours and keep at least 3 to 1 contrast against the disc background.
- **DP-77 — Transactional outbox** A confirmed upload is marked `stored` and queued for parsing in one database transaction, and parse jobs and webhook sends reach the broker only through the outbox, as qualified in Services.
- **DP-78 — Queue topology** The parse and webhook exchanges and quorum queues exist with the names and arguments in Services, and every app instance consumes them with manual acknowledgement after its work commits.
- **DP-79 — Redelivered parses add nothing** A parse job delivered more than once, including after a crash or a second relay, adds no second sample, transcript line, search document, version increase, audit entry, webhook or push alert.
- **DP-80 — Parser failures dead-lettered** A capture the parser cannot finish is redelivered until the parse queue's delivery limit dead-letters it, and the pass then shows `rejected` with reason `parser_failed` and no line number.
- **DP-81 — Parse queue outage and recovery** With the parse queue unreachable, uploads still answer 202 and stay `stored` with the queued copy and banner, and when it answers again every waiting pass parses in upload order without a restart.
- **DP-82 — Reference ephemeris fetch** Setting a mission's reference target fetches every page of the ephemeris service's vectors for the mission's time span and stores them in metres, metres per second and Unix milliseconds, as qualified in Services.
- **DP-83 — Considerate ephemeris client** The ephemeris client honours `Retry-After` in both its forms, revalidates with `If-None-Match`, and never has more than one request in flight per mission across instances.
- **DP-84 — Ephemeris failures** An unknown target is refused with the field error in API and changes nothing, while a failing, slow or malformed ephemeris answer leaves the reference `unavailable` and everything else working.
- **DP-85 — Residuals** Each sample's residual is its distance from the reference position interpolated at its UTC, shown as the readout's `ΔR` line, the event list's residual column and the dossier's perilune lines, or as a dash where the reference has no value there.
- **DP-86 — Set a reference journey** The author types a reference target on the seeded mission, sees the reference become ready, and reads `ΔR` values on the readout that a freshly opened share page repeats.
- **DP-87 — Mission dossier** Both consoles download a mission dossier PDF rendered by the PDF renderer, A4 portrait, titled and named after the mission with RFC 6266 and RFC 8187 parameters, with the sections, order and display formats in Services and private notes only in the author dossier.
- **DP-88 — Text fields refuse control characters** Mission names, event titles, private notes and landmark names refuse control characters and line or paragraph separators with the published field error, and count their length in code points after NFC.
- **DP-89 — Renderer outage** With the PDF renderer unreachable or slower than 10 seconds, dossier requests answer the renderer outage status and the console announces the published copy, while everything else works.
- **DP-90 — Share rate limit** Each share link is limited to 120 requests in any rolling 60 seconds across all app instances, answering 429 with `Retry-After` and rate-limit fields beyond that, and serving without a limit while the cache is unreachable.
- **DP-91 — Live reader count** The author console's Share region shows how many share pages of the mission are open across all instances, updating within 5 seconds of a reader arriving or closing the page.
- **DP-92 — Released on close** Closing a share page, a stream or a download part-way releases its server work at once, leaving no database session active or idle in a transaction.
- **DP-93 — Archive plan billing** The Archive plan catalogue, the author's billing account and its subscription live in the billing system in decimal major units, while the app keeps integer cents and bytes and changes its plan only after billing confirms, as qualified in Services.
- **DP-94 — Archive plan display** The Missions page's Archive plan region shows each plan's price, the current quota, the bytes used, the next invoice date and the balance in the published formats.
- **DP-95 — Storage quota** An upload that would take the bytes of all non-deleted passes above the plan's quota is refused with `quota_exceeded`, reaching the quota exactly is allowed, and of simultaneous uploads near the limit only those that fit succeed.
- **DP-96 — Upgrade the Archive plan journey** The author is refused an upload over the free quota, upgrades to the 1 GiB plan on the Missions page, sees the price, quota, next invoice date and balance from billing, and the retried upload succeeds.
- **DP-97 — Mission subscribers** The author adds and removes up to three subscriber URLs per mission, each an endpoint of the mission's webhook application, with the answers in API.
- **DP-98 — Signed change webhooks** Each pinned event, parsed, rejected or deleted pass and revoked or replaced share link sends exactly one signed webhook whose event id is the mission and change version and whose payload never holds a note, relayed through the outbox and delivered once after a webhooks outage.
- **DP-99 — Parse outcome push alerts** Each parse outcome publishes exactly one push alert to the mission's topic with the title, message, priority, tags and click in Services, is never retried when push is unreachable, and is never sent for the seed pass.

## Frontend

### Screens and layout (DP-02, DP-06, DP-18, DP-32, DP-43, DP-53, DP-62, DP-66, DP-67, DP-73, DP-94, DP-97)

There are five screens. At 375x812, 768x1024, 1280x800 and every width up to 1920, the page never scrolls horizontally: the document's scroll width equals the viewport width.

**Missions page (`/`).**
- A level-one heading, the outage banners for this page, the missions list (oldest first, each entry a link to its console), the New mission form, then the Archive plan region.
- One column at every viewport. Body text runs to at most about 40 characters per line and is centred on wide screens.

**Author console (`/missions/<mission id>`).** It has these parts:
- header row: the mission name (level-one heading), the epoch line, the perilune summary, and the Channels button below 1280
- outage banners, stacked under the header
- the oversized MET readout, spanning the top rule
- the channel rail: two unit radio groups and two channel checkboxes
- the disc pane: the track canvas, the lens and the readout plate
- under the disc: the Go to GMT row, the playback row (Play and the playback rate), then the Pin event button
- Events region: the Events table (with the author's Note column) and the dossier link
- Landmarks region: the add form (author only) and the list
- Reference region: the target field, its buttons and the reference line
- Passes region: the capture file input, the passes list and download links
- Share region: the expiry field, the link controls and the reader count
- Subscribers region: the subscriber URL field and the subscribers list
- Transcript region: the search box, results, search status, the Speakers list and transcript lines

**Share page (`/s/<token>`).**
- It is the same console with nothing that writes. These are absent: Pin event, the Note column, the landmark form and Remove buttons, the Reference region, the Passes region, the Share region and the Subscribers region. The playback row stays.
- The header adds the link's expiry line.
- A Captures list of download links takes the place of Passes.
- The Events region holds the event list and dossier links.
- A withdrawn, expired, rate-limited or unknown link shows only its full-page heading and line.

**Not found.** Unknown mission ids and paths show the headings from Feedback states.

**Published layouts.** These apply to both consoles. The order given is both reading order and Tab order.

- **375x812, one column.** In order:
  1. the sticky MET band
  2. the header
  3. the banners
  4. the disc, full width and square
  5. the readout plate, docked directly under the disc
  6. the Go to GMT row
  7. the playback row
  8. Pin event (author)
  9. Transcript
  10. Events
  11. Landmarks
  12. Reference (author)
  13. Passes or Captures
  14. Share (author)
  15. Subscribers (author)

  The channel rail is a closed drawer, opened with the Channels button.
- **768x1024, track plus readout.**
  - The sticky MET band, the header and the banners span the full width.
  - In the next row, the disc takes the left two thirds. The right third starts level with the disc's top and holds, in order, the readout plate, the Go to GMT row, the playback row and Pin event (author).
  - Below that, full width: Transcript, Events, Landmarks, Reference, Passes or Captures, Share, then Subscribers.
  - The channel rail is a closed drawer.
- **1280x800 and wider, three panes on a 12-column grid.**
  - The channel rail is a permanent left column, two columns wide.
  - The disc pane is seven columns in the centre. Under the disc come the Go to GMT row with Pin event beside it, the playback row, then Events, Landmarks, Reference, Passes or Captures, Share and Subscribers.
  - The Transcript region is the right column, three columns wide.
  - The tops of all three panes are visible without scrolling.
  - The readout plate floats beside the lens, on whichever side has room inside the centre pane. When the lens is closed, the plate rests at the top right of the disc pane.
  - There is no Channels button and no sticky band.

No other breakpoint changes which layout a published viewport gets.

**Sticky MET band (below 1280).** The MET readout and the Channels button form one band, pinned to the top of the viewport while the page scrolls. The rest of the header scrolls away.

**Uncovered controls.** At every viewport, whenever a control receives keyboard focus or the page scrolls it into view:
- No part of it is under the sticky band, an open drawer, an open dialog or the readout plate. The one exception: at 1280 and wider the plate floats inside the disc pane over the `Track loupe` slider, so that slider alone is exempt from the plate rule there.
- Its top edge is below the band's bottom edge, unless the control is inside the band.
- At its centre point it is the topmost element or contains the topmost element.

An open drawer or dialog fits inside the viewport and scrolls internally when its content is taller. This is stricter than WCAG 2.2 SC 2.4.11.

**Events region.**
- At 375, the Events table keeps all its columns and scrolls horizontally inside its own region, which takes keyboard focus.
- A pointer click on any cell, including the last column after horizontal scrolling, lands on that cell.

**Empty mission.** While a mission has no parsed samples:
- The disc pane shows the empty-mission heading and line instead of the disc.
- The slider, lens, readout plate, Go to GMT row, playback row and Pin event are absent.
- The Landmarks, Reference and Subscribers regions stay.

**Lunar disc.** A procedural orthographic view of the Moon, centred on latitude 0 and the perilune's longitude λ0 (λ0 = 0 when there is no perilune), with north up. It shows:
- soft grey shading for maria and highlands
- a graticule every 30 degrees
- a 2-pixel rust-orange ground track joining samples in track order, with samples on the hidden hemisphere joined by a faint dotted line
- a small rust-orange triangle at the perilune
- a small rust-orange square at each landmark on the visible hemisphere
- ticks at transcript line positions and a pin mark at each event, each while its channel is on

**Disc geometry.**
- The drawing surface is the `Track loupe` slider element, which is square and fills its pane's width up to the available height.
- The disc fills that element. Its centre (cx, cy) is the element's centre, and its radius R is half the element's CSS width.
- A point at latitude φ and longitude λ is visible when `cos φ · cos(λ − λ0) > 0`.
- It is drawn at `x = cx + R · cos φ · sin(λ − λ0)`, `y = cy − R · sin φ`, in CSS pixels from the element's top-left corner.
- The backing store is the CSS size times the device pixel ratio (HiDPI).
- Every distance in the pointer and touch rules is in CSS pixels, whatever the device pixel ratio.

### Public screens and controls (DP-11, DP-12, DP-14, DP-18, DP-20, DP-21, DP-29, DP-30, DP-31, DP-34, DP-35, DP-42, DP-50, DP-53, DP-56, DP-57, DP-58, DP-59, DP-60, DP-62, DP-67, DP-71, DP-73, DP-82, DP-85, DP-87, DP-91, DP-94, DP-97)

Only these roles, names and copy are public. Everything else is up to you. Placeholders are defined in Business rules.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| `heading` level 1 `Missions` | Missions page | `Missions` |
| `list "Missions"` with one `link "<mission name>"` per mission | Missions page | mission name |
| `textbox "Mission name"` | Missions page | label `Mission name` |
| `textbox "Epoch (GMT)"` | Missions page | label `Epoch (GMT)`, placeholder `2026-073/00:00:00` |
| `button "Create mission"` | Missions page | `Create mission`; on success the console opens |
| `region "Archive plan"` | Missions page | heading `Archive plan`; lines `Plan <plan label>: <plan price>`, `Used <used> of <quota>`, `Next invoice <next invoice>`, `Balance <balance>` |
| `radiogroup "Plan"` with `radio "Free, 256.0 MiB"`, `radio "Archive 1 GiB, 4.00 USD/month"`, `radio "Archive 10 GiB, 24.00 USD/month, billed 288.00 USD yearly"` | Archive plan region | the same words; the current plan is checked on load |
| `button "Change plan"` | Archive plan region | `Change plan` |
| `status "Plan status"` | Missions page | polite live region |
| `heading` level 1 `<mission name>` | both consoles | mission name |
| epoch line | both consoles, header | `Epoch <epoch_gmt>` |
| perilune summary | both consoles, header | `Perilune <altitude> at <met_label>`; absent with no samples |
| link expiry line | share page, header | `Expires <expires_gmt>` |
| `alert` banners | screens named in Feedback states | outage copy from Feedback states |
| `button "Channels"` | both consoles, below 1280, in the sticky band | `Channels`; carries expanded state |
| `dialog "Channels"` (below 1280) or `complementary "Channels"` (1280 and wider) | both consoles | holds the controls below |
| `radiogroup "Distance"` with `radio "km"`, `radio "nmi"` | channel rail | `km`, `nmi` |
| `radiogroup "Speed"` with `radio "m/s"`, `radio "ft/s"` | channel rail | `m/s`, `ft/s` |
| `checkbox "Event pins"`, `checkbox "Transcript ticks"` | channel rail | checked on open; affect this view only |
| `button "Close channels"` | drawer only | `Close channels` |
| `slider "Track loupe"` | disc pane | the track canvas; minimum 0, maximum `<sample count> - 1`, value = lens sample index, value text `<met_label>, altitude <altitude>` |
| `img "Loupe"` | disc pane | the circular lens, 160 by 160 CSS pixels when fully open; present only while open |
| `group "Readout"` | readout plate | one line each, in order: `MET <met_label>`, `GMT <gmt>`, `LAT <latitude>`, `LON <longitude>`, `ALT <altitude>`, `SPD <speed>`, then `ΔR <residual>` only while the mission has a reference, then `Range to <landmark name> <range>` per landmark in creation order |
| `textbox "Go to GMT"` | Go to GMT row | label `Go to GMT`, placeholder `2026-073/02:00:00` |
| `button "Go"` | Go to GMT row | `Go` |
| `button "Play"` | playback row | `Play`; while playing the same button is named and reads `Pause` |
| `radiogroup "Playback rate"` with `radio "1×"`, `radio "10×"`, `radio "60×"` | playback row | the same words (× is U+00D7); `1×` checked on open; disabled while playing |
| `button "Pin event"` | author console | `Pin event` |
| `dialog "Pin event"` | author console | heading `Pin at <met_label>`; in order `textbox "MET"`, `textbox "Title"`, `textbox "Private note"`, `button "Save event"`, `button "Cancel"` |
| `region "Events"` | both consoles | heading `Events`; focusable horizontal scroll container at 375 |
| `table "Events"` | Events region | columns `MET`, `Title`, `Altitude`, `Speed`, plus `Note` on the author console only; rows in MET order |
| `link "Download event list"` | Events region, share page | `Download event list`; its address always carries `distance` and `speed` for the current units |
| `link "Download dossier"` | Events region, both consoles | `Download dossier`; on the share page its address always carries `distance` and `speed` for the current units |
| `region "Landmarks"` | both consoles | heading `Landmarks` |
| `textbox "Landmark name"`, `textbox "Latitude"`, `textbox "Longitude"` | Landmarks region, author | placeholders `Tessera-3 landing site`, `12.5° S`, `45.25° W` |
| `button "Add landmark"` | Landmarks region, author | `Add landmark` |
| `list "Landmarks"` | Landmarks region | items `<landmark name> <latitude>, <longitude>` in creation order; when empty, the line `No landmarks` |
| `button "Remove <landmark name>"` | each landmark item, author | `Remove` |
| `region "Reference"` | author console | heading `Reference` |
| `textbox "Reference target"` | Reference region | placeholder `TESSERA-3` |
| `button "Set reference"` | Reference region | `Set reference` |
| `button "Refresh reference"` | Reference region, only while a target is set | `Refresh reference` |
| reference line | Reference region | `<reference line>` |
| `region "Passes"` | author console | heading `Passes` |
| file input labelled `Capture file` | Passes region | choosing a file starts the upload |
| `list "Passes"` | Passes region | per non-deleted pass: filename, state text, size in bytes; focusable from script |
| pass state text | each pass item | `Uploading`, `Stored`, `Parsed: <samples> samples`, `Rejected at line <line>: <reason text>`, or `Rejected: <reason text>` when there is no line |
| `button "Delete <filename>"` | each parsed or rejected pass | `Delete` |
| `link "Download <filename>"` | each stored, parsed or rejected pass; share Captures list | `Download` |
| `alertdialog "Delete pass"` | author console | `Delete <filename>? Its samples, transcript lines, pinned events and stored capture are removed for good.`; `button "Delete pass"`, `button "Keep pass"` |
| `region "Share"` | author console | heading `Share` |
| `textbox "Link expiry (GMT)"` | Share region | placeholder `2026-103/00:00:00`; optional |
| `button "Create share link"` | Share region, no active link | `Create share link` |
| `textbox "Share link"` (read-only) | Share region, active link | absolute share URL |
| expiry text | Share region, active link | `Expires <expires_gmt>` |
| `button "Copy link"`, `button "Replace share link"`, `button "Revoke share link"` | Share region, active link | the same words |
| reader count | Share region, always | `Readers now: <readers>` |
| `region "Subscribers"` | author console | heading `Subscribers` |
| `textbox "Subscriber URL"` | Subscribers region | placeholder `https://club.example/hooks/perilune` |
| `button "Add subscriber"` | Subscribers region | `Add subscriber` |
| `list "Subscribers"` | Subscribers region | items `<subscriber url>` in creation order; when empty, the line `No subscribers` |
| `button "Remove <subscriber url>"` | each subscriber item | `Remove` |
| `list "Captures"` | share page | one `link "Download <filename>"` per parsed pass |
| `region "Transcript"` | both consoles | heading `Transcript` |
| `searchbox "Search transcript"` | Transcript region | placeholder `Search lines and events` |
| `list "Search results"` | Transcript region | each item a `button` named `<met_label> <speaker>: <text>` for a line hit or `<met_label> <title>` for an event hit; focusable from script; after an empty search it shows `No results` |
| `list "Speakers"` | Transcript region | items `<speaker> <lines>` in the speaker order; when empty, the line `No speakers` |
| `list "Transcript lines"` | Transcript region | each item a `button` named `<met_label> <speaker>: <text>`; the current one carries current-state `true` |
| `status "Upload status"` | author console | polite live region |
| `status "Search status"` | both consoles | polite live region |
| `status "Console status"` | author console | polite live region for pins, units, landmarks, reference, sharing, subscribers and deletions |
| `status "Download status"` | both consoles | polite live region for capture and dossier downloads |

Every field error appears under its field, is linked to the field as its error message, and marks the field invalid.

### Interactions (DP-11, DP-12, DP-13, DP-14, DP-15, DP-17, DP-18, DP-21, DP-24, DP-26, DP-29, DP-30, DP-46, DP-47, DP-49, DP-50, DP-53, DP-55, DP-56, DP-58, DP-59, DP-61, DP-63, DP-65, DP-66, DP-67, DP-74, DP-81, DP-86, DP-87, DP-91, DP-96, DP-97)

**Pointer.**
- When the pointer enters the canvas, or moves over it while the lens is closed, the lens grows at the nearest visible sample whose projected point is within 24 CSS pixels of the pointer, centred on that sample's projected point (not on the pointer). If no sample is that close, the lens stays closed. It shows the disc and track magnified four times, with a crosshair on the sample.
- As the pointer moves, the lens snaps to the nearest visible sample whose projected point is within 24 CSS pixels of the pointer. If no sample is that close, the lens stays where it is.
- Each snap updates the plate, the MET readout, the slider value and the current transcript line.
- When the pointer leaves, the lens shrinks away and the plate keeps the last sample.
- Releasing the button writes the moment link.

**Keyboard on the slider.**
- The canvas is in Tab order. Focus grows the lens at the current sample.
- Right and Up go to the next sample. Left and Down go to the previous one.
- Shift plus an arrow moves 60 samples, clamped at the ends.
- Home and End go to the first and last sample.
- Samples on the hidden hemisphere are reachable by keyboard. The lens centres on their dotted position (the same projection without the visibility test).
- Key-up writes the moment link.
- On the author console, Enter opens Pin event.
- Blur shrinks the lens.

**Touch.**
- One finger touching down on the disc opens the lens at the nearest visible sample whose projected point is within 24 CSS pixels of the touch point. If no sample is that close, the lens stays closed and the touch scrolls the page normally.
- Once the lens is open, dragging moves it under the pointer snapping rule without scrolling the page.
- Lifting the finger keeps the lens and plate on the last sample and writes the moment link.
- Outside the disc, one-finger swipes scroll the page normally.

**Go to GMT.**
- Enter or `Go` parses the box as a day-of-year time and converts it to a MET: the instant minus the epoch.
- The snapping rule picks the lens sample. The slider value, plate, MET readout and current line update, and the moment link is written, exactly as after a key step.
- The lens does not open, and focus stays in the box.
- An empty or malformed value shows the day-of-year field error, and nothing else changes.

**Playback.**
- `Play` starts playback at the lens sample's MET, or at the first sample when the lens is on the last one. The button becomes `Pause` with focus kept on it, and the `Playback rate` radios are disabled.
- Elapsed playback time `e` (milliseconds) is measured only from the page's monotonic clock (`performance.now()` or animation-frame timestamps), starting at the press. The playback MET is `start_met_ms + e · rate`, where rate is 1, 10 or 60.
- The frame rate is 10 per second at `1×` and 25 per second at `10×` and `60×`. The frame shown is the one with the largest `met_ms` at or before the playback MET on the frames grid that starts at `start_met_ms` (the frames API grid with `from` = the start MET).
- While playing, the plate shows:
  - `MET` and `GMT` for the frame's `met_ms` rounded down to the whole second
  - `LAT`, `LON`, `ALT` and `SPD` from the frame, under the display formats
  - `ΔR` and `Range to` lines from the snapped sample (the sample at or before the frame's MET)
- The MET readout follows the plate. The slider value, value text and current line follow the snapped sample. An open lens centres on the frame's projected point.
- The values shown equal the server frames API's values for the same grid, formatted by the display rules.
- When the playback MET reaches the last sample's MET, the plate shows the last sample, playback stops, the button returns to `Play` and the moment link is written.
- `Pause` stops playback. The lens sample becomes the snapped sample of the frame shown, the plate shows that sample's own values, and the moment link is written.
- A key step, a pointer or touch pick, a Go to GMT jump, a line or result pick, or a track reload pauses playback first and then acts.
- While playing, the address is not written.
- Under reduced motion, playback shows no interpolated frames: every plate line comes from the sample at or before the playback MET and changes only when that sample changes. Timing, ending and pausing are unchanged.

**The address.** These parameters hold the view:

| Parameter | Meaning | Consoles |
|---|---|---|
| `t` | lens sample MET in whole seconds | both |
| `q` | trimmed search text | both |
| `distance` | `km` or `nmi` | share page only |
| `speed` | `m_s` or `ft_s` | share page only |

Writing the address:
- Every write replaces the current history entry. It changes only its own parameter and keeps all others, including parameters this console ignores.
- The query string is written with the WHATWG URL Standard's `application/x-www-form-urlencoded` serializer and read with its parser. For example, the search text `pass+1 Kestrel` is written `q=pass%2B1+Kestrel`, and `q=a+b%2Bc` opens with the box holding `a b+c`.
- `t` is written when a pointer is released, a finger lifts, a key step ends, a Go to GMT jump succeeds, playback is paused or ends, or a line or result is picked.
- `q` is written when a search runs and removed when the box is cleared.
- On the share page, choosing a unit writes `distance` or `speed`.

Opening a console with these parameters:
- `t` places the lens sample by the snapping rule. A missing or non-integer `t`, or one before every sample, uses the first sample. The lens stays closed until pointer, touch or focus, but the plate, MET readout and current line show the placed sample from the start.
- A `q` that trims to 1 to 200 characters fills the box and searches at once, with no debounce, and the count is announced. Any other `q` is ignored.
- On the share page, each valid `distance` or `speed` is used. Each one that is missing or invalid falls back to the mission's saved unit independently. The author console ignores both.

**Transcript.**
- The current line gets a deep blue rule on its left and current-state `true`, and the list scrolls it into view.
- Click, Enter or Space on a line moves the lens to the sample at or before its MET and writes the moment link.
- The Speakers list reloads with the transcript.

**Search.**
- A search runs a quarter of a second after the last keystroke, with results in MET order.
- Picking a result behaves like picking a line, and `q` stays.
- Clearing the box empties the results and the search status.
- A reply is applied only if its query is still the trimmed box text. Late replies to earlier queries or refreshes are discarded, and the final keystroke is always searched.

**Search refresh.** While the box holds a query, it runs again:
- on the author console, after each of these is saved from this console: an event pinned, a pass reaching `parsed`, a pass deleted
- on the share page, after each pushed change

A refresh replaces the results in place, shows no pending copy, and announces only its final count. It leaves the box text, caret and focus alone. If the focused result disappears, focus moves to the `Search results` list.

**Channels.**
- At 1280 and wider the rail is always shown.
- Below 1280, `Channels` opens the rail as a modal drawer from the left edge:
  - focus moves to the checked Distance radio
  - Tab and Shift+Tab wrap inside the drawer
  - Escape or `Close channels` closes it and returns focus to `Channels`
- A closed drawer is hidden and inert at every viewport: nothing in it is visible, focusable or in the accessibility tree. Moving it off-screen is not closing it.
- A unit choice on the author console updates the plate (including range and `ΔR` lines), the Events table and the perilune summary at once, and saves to the mission with a merge patch holding only the member that changed (`{"distance_unit":"nmi"}`, for example).
- A unit choice on the share page changes only the reader's view, the address, and the event list and dossier links.
- The checkboxes show or hide pins and ticks for this view only.

**New mission.**
- `Create mission` checks `Epoch (GMT)` in the browser. If it is malformed, no request is sent, the day-of-year field error shows and focus moves to the field.
- Otherwise the console sends the name and the matching ISO instant. The browser time zone never takes part.
- API field errors show under their fields, with focus on the first field in error.

**Archive plan (Missions page).**
- The region reads the plan on load, after each plan change, and whenever the Missions page's 10-second status check runs. That last read never moves focus or changes the checked radio while a change is pending.
- `Change plan` sends the checked radio's plan. Choosing the current plan sends nothing and announces nothing.
- While its request is pending, `Change plan` and the radios are disabled.
- On success, the region's lines show the answer, and the checked radio is the new plan.
- On any refusal, the region keeps its previous lines, the checked radio returns to the current plan, and focus stays on `Change plan`.

**Pin event.**
- `Pin event`, or Enter on the slider, opens the dialog for the lens sample:
  - `MET` is prefilled with the sample's `<met_label>`
  - the heading reads `Pin at <met_label>`
  - focus moves to `Title`
  - each opening gets one fresh request key, used for every save from that opening
- Tab and Shift+Tab wrap through MET, Title, Private note, Save event and Cancel. Enter in Title submits.
- Save event:
  - `MET` is checked first. A malformed MET shows the MET field error, moves focus there and sends nothing.
  - A well-formed MET is sent as whole seconds, and the heading becomes `Pin at <met_label>` for the typed MET.
  - Save event is disabled while its request is pending.
- Escape or Cancel closes without saving.
- After saving or cancelling, focus returns to the slider, or to `Pin event` if that opened the dialog.
- An API field error keeps the dialog open. `met` shows under MET, `title` under Title and `note` under Private note, with focus on the first field in error.

**Landmarks (author).**
- `Add landmark`, or Enter in any of its three fields, checks Latitude and Longitude in the browser. A failing field shows its coordinate field error, focus moves to the first failing field, and nothing is sent.
- Otherwise the console sends the trimmed name and both values as signed decimal degrees. Every accepted spelling of one value sends the same number.
- On success, the landmark joins the end of the list, its square and range line appear, the fields clear, and focus stays in `Landmark name`.
- API errors show under their field. `landmark_limit` and `landmark_name_taken` show under `Landmark name`, with focus there.
- `Remove <landmark name>` removes the landmark at once, with no confirmation. Its item, square and range line go, and focus moves to `Landmark name`.

**Reference (author).**
- `Set reference`, or Enter in `Reference target`, sends the trimmed text as the target. When the trimmed text is empty, it sends the merge patch `{"reference_target":null}` instead.
- `Refresh reference` refreshes the saved target.
- While the request is pending, both buttons are disabled.
- On the answer, the reference line, the plate's `ΔR` line and the event list reflect the result. After a clear, the `ΔR` line and `Refresh reference` are gone.
- The API field error shows under `Reference target`, with focus there.

**Subscribers (author).**
- `Add subscriber`, or Enter in `Subscriber URL`, sends the trimmed text. `Add subscriber` is disabled while its request is pending.
- On success, the URL joins the end of the list, the field clears and focus stays in it.
- API field errors, `subscriber_limit` and `subscriber_exists` show under `Subscriber URL`, with focus there.
- `Remove <subscriber url>` removes the subscriber with no confirmation. On success its item goes and focus moves to `Subscriber URL`. On refusal the item stays and focus stays on its button.

**Upload.**
- Choosing a file gives it one fresh request key. The console computes the SHA-256 in the browser and sends the unchanged bytes with the percent-encoded filename, the checksum and the key.
- The pass shows `Uploading`, and a progress rule fills with the bytes sent.
- Retries:
  - A request that ends with no HTTP answer is resent once, 1 second later, with the same key and bytes.
  - An `idempotency_request_in_progress` answer is asked again under the same key once a second until another answer arrives.
  - No other answer is retried automatically. Choosing the same file again after a refusal gives it a fresh key.
- `Stored` shows only on the server's 202. The console then reads `GET /api/status` once to choose the stored copy.
- It checks the pass once a second until the pass is parsed or rejected. On `parsed`, the track, transcript, speakers, events, perilune and slider range reload under the track-reload rule.

**Downloads.**
- Each download link's address is its route. Activating it downloads without leaving the page.
- A refusal never navigates away and is announced in `Download status`.

**Delete a pass.**
- `Delete <filename>` opens `Delete pass` with focus on `Keep pass`. Tab and Shift+Tab wrap between the two buttons.
- Escape or `Keep pass` closes the dialog and returns focus to the delete button.
- `Delete pass` disables both buttons while its request is pending.
- On success, the dialog closes, the pass leaves the list, the views reload and focus moves to the `Passes` list.
- On failure, the dialog closes, the pass stays and focus returns to its delete button.

**Share.**
- `Create share link` and `Replace share link` check `Link expiry (GMT)`:
  - empty: no expiry is sent, and the default applies
  - malformed: no request, the day-of-year field error, focus to the field
  - otherwise: the matching ISO instant is sent
- On success, the region shows the absolute URL and the expiry text.
- `Copy link` copies the URL. `Revoke share link` revokes the link and returns the region to `Create share link`.
- The region reflects the mission as of its last load: on open and after each action in this console.
- The reader count follows the author stream and changes without a reload.

**Live share page.**
- An open share page holds its link's change stream open with `EventSource`.
- On a `mission-changed` message whose version differs from the last one applied, the page refetches the share mission, track, transcript, speakers, events and landmarks in place. The track-reload rule and the search refresh apply.
- The reader's units never change because of a push.
- A dropped stream resumes from the last event id under the WHATWG `EventSource` reconnection model.
- When any share request answers withdrawn or expired, the console is replaced by the matching full page without a reload.
- A share data request answered 429 is retried once after its `Retry-After`. Meanwhile the page stays as it is.
- Pushed changes are applied as they arrive, never on a timer.

**Outage banners.**
- Each screen that shows banners reads the service status on load, after any outage answer, and every 10 seconds.
- A banner shows while its service is down and disappears at the first check that finds the service up.

### Visual design (DP-42, DP-43, DP-44, DP-76)

**Mood and numerals.** Measured, dusty and exact, like a lab instrument. Every numeral is set in a tabular monospaced face so digits line up in columns: MET, GMT times, coordinates, altitudes, ranges, residuals, speeds, byte counts, sizes, prices, balances, reader counts, speaker counts and expiries.

**Colour.**
- The ground is a warm regolith grey, with no pure white anywhere, including fields and dialogs.
- Text and primary button fills use a near-black ink, with ground-grey button text.
- Rust orange is the accent: track, lens rim, crosshair, perilune triangle, landmark squares, pins and the progress rule. It is never used for small text.
- A deep slate blue is the signal colour: links, the current transcript line, focus marks and selected radios.
- A mid warm grey is used only for hairline rules and the graticule.
- Secondary text uses a darker grey that passes AA on the ground.

**Type.**
- Archivo for headings, IBM Plex Sans for body text, and IBM Plex Mono for every numeral and the readout plate.
- Each heading step is about a third larger than the one below it.
- The MET readout is about six steps above body text, roughly five to six times body size. In the sticky band below 1280 it may sit one or two steps smaller.
- Labels beside numerals are small mono capitals.

**Density and composition.**
- Compact rows with tight spacing in tables and lists.
- A rigid 12-column grid, with single hairline rules between panes and between table rows.
- No shadows, rounded cards, gradients or background images.

**Size, focus and contrast.**
- Every interactive control is at least 44 by 44 CSS pixels, including radios, checkboxes, list buttons, Remove buttons, the playback controls and download links. This exceeds WCAG 2.2 SC 2.5.8.
- Keyboard focus shows a 2-pixel deep blue outline.
- WCAG 2.2 Level AA applies in full. The track, lens rim, landmark squares and focus outline reach 3 to 1 against the ground.

**Forced colours.** Under `forced-colors: active`, the disc is drawn in system colours resolved from computed styles at draw time, and is redrawn when the mode or colour scheme changes:

| Element | System colour |
|---|---|
| disc fill | `Canvas` |
| ground track, perilune triangle and crosshair | `CanvasText` |
| lens rim | `Highlight` |
| pins and landmark squares | `LinkText` |
| graticule | `GrayText` |
| maria shading | omitted |

The track and every mark keep at least 3 to 1 contrast against the disc fill. The lens's magnified view uses the same colours.

**Fonts.** All three faces ship with the app and are served from its own origin. The dossier uses the same faces.

### Motion and effects (DP-11, DP-15, DP-53)

Every movement starts fast and settles gently, and finishes in under half a second. Nothing moves while the user is idle: no spinning disc, pulses, shimmer or decorative loops. Playback moves only while the user has it running.

- **Lens.** On enter, focus or touch, it grows from nothing to its full 80-pixel radius in about a fifth of a second, centred on the snapped sample. It shrinks away in the same time. Each snap slides it to the new sample in about a fifth of a second.
- **Numeral roll.**
  - Each changed digit rolls vertically to its new value in about a quarter of a second: upward when the value grows, downward when it shrinks.
  - Unchanged digits stay still.
  - The MET readout and the whole plate roll together.
  - Accessible text and the slider value text change at once.
  - During playback, numerals change in place with no roll, frame by frame.
- **Playback.** The lens, when open, moves with each frame without a slide. Pausing leaves everything still at once.
- **Current line.** The blue rule fades in over about a fifth of a second, and the list glides the line into view in under half a second.
- **Drawer.** It slides in from the left in about a quarter of a second, slides out in the same time, and is then hidden.
- **Upload progress.** The rule fills left to right with the bytes sent and never cycles.
- **Banners, dialogs, pushed changes, refreshed results, plan lines and reader count changes.** These fade only, in at most a fifth of a second.

**Signature: Track loupe.**
1. Pointer enter or touch start within 24 CSS pixels of a visible sample opens the lens at the nearest such sample, and keyboard focus opens it at the current sample.
2. The lens grows to full size, and the magnified track and crosshair fill it.
3. The plate and MET readout roll to the sample's values, and the current line moves.
4. Each snap or key step slides the lens and rolls the changed digits.
5. Stepping back retraces the same samples, one key press at a time.
6. Release, key-up or lifting the finger writes the moment link.

**Reduced motion.**
- The lens appears and disappears at full radius at once and jumps between samples.
- Numerals change in place.
- The current-line rule appears at once, and the list jumps to the line.
- The drawer shows and hides without sliding.
- Playback shows samples only, as stated under Interactions.
- Snapping, stepping, touch drag, Go to GMT, the live readout, the current line and moment links behave exactly as with motion on.

### Feedback states (DP-02, DP-05, DP-25, DP-36, DP-38, DP-49, DP-50, DP-51, DP-56, DP-59, DP-61, DP-74, DP-81, DP-84, DP-88, DP-89, DP-90, DP-93, DP-95, DP-97)

Every message below appears on screen and in its named polite live region, character for character. These rules apply:
- Quotes are straight, an ellipsis is three ASCII dots, and digits carry no separators except in the byte limit.
- `<message>` is the first field message of the API response, in the order the endpoint lists its fields, or the `message` member of a 409 that carries one.
- `1 sample`, `1 transcript line`, `1 result` and `1 vector` are singular. Every other count is plural.
- Each message is announced once per action, however many requests the action makes.
- Play and Pause announce nothing.

| Action | Region | Pending | Success | Field error or conflict | Outage |
|---|---|---|---|---|---|
| Upload | `Upload status` | `Uploading <filename>...` | `<filename> stored, checksum verified. Parsing...`, or `<filename> stored, checksum verified. Queued for parsing...` when the status read after the 202 reports the queue down; then `<filename> parsed: <samples> samples, <lines> transcript lines.`, `<filename> rejected at line <line>: <reason text>.` or, with no line, `<filename> rejected: <reason text>.` | duplicate: `<filename> is already on this mission.`; quota: `<filename> is over your Archive quota (<used> of <quota>).`; too large: `<filename> is over the 5,000,000-byte limit.`; other 422: `<filename> was not uploaded: <message>` | `<filename> was not stored. Capture storage is offline.` |
| Search (typed or from `q`) | `Search status` | `Searching...` | `<count> results for "<query>"`, `1 result for "<query>"`, `No results for "<query>"` | none | `Search is offline.` |
| Search refresh | `Search status` | none | as Search | none | `Search is offline.` |
| Pin event | `Console status` | `Pinning event...` | `Event pinned at <met_label>.` (the snapped sample's label) | message under its dialog field | none |
| Add landmark | `Console status` | none | `Landmark <landmark name> added.` | message under its field | none |
| Remove landmark | `Console status` | none | `Landmark <landmark name> removed.` | none | none |
| Set, refresh or clear reference | `Console status` | `Fetching reference <target>...` (not for a clear) | outcome `updated`: `Reference <target> ready: <vector_count> vectors.`; outcome `unchanged`: `Reference <target> unchanged.`; outcome `unavailable`: `Reference <target> is unavailable. ΔR shows — until a refresh succeeds.`; clear: `Reference cleared.` | message under `Reference target` | none |
| Save units | `Console status` | none | `Units saved: <distance unit> and <speed unit>.` with the radio labels | none | `Units could not be saved. The share page still opens in the previous units.` |
| Share | `Console status` | none | create: `Share link ready. It expires <expires_gmt>.`; replace: `New share link ready. The previous link no longer works. It expires <expires_gmt>.`; revoke: `Share link revoked. It no longer works.` | message under `Link expiry (GMT)` | none |
| Add subscriber | `Console status` | none | `Subscriber <subscriber url> added.` | message under `Subscriber URL` | `Subscribers could not be changed. Webhooks are offline.` |
| Remove subscriber | `Console status` | none | `Subscriber <subscriber url> removed.` | none | `Subscribers could not be changed. Webhooks are offline.` |
| Change plan | `Plan status` | `Changing plan...` | `Plan changed to <plan label>.` | too small: `<plan label> holds <quota>, and <used> is stored.` | `The plan was not changed. Billing did not confirm it.` |
| Delete pass | `Console status` | `Deleting <filename>...` | `<filename> deleted.` | `<filename> is still being processed.` | storage: `<filename> was not deleted. Capture storage is offline.`; search: `<filename> was not deleted. Transcript search is offline.` |
| Capture download | `Download status` | none | none | gone: `<filename> is no longer available.`; rate limited: `Too many requests for this replay link. Try again in <retry_seconds> seconds.` | `<filename> was not downloaded. Capture storage is offline.` |
| Dossier or event list download | `Download status` | none | none | rate limited: as Capture download | dossier: `The dossier was not created. The PDF renderer is offline.` |

In the Change plan row, `<quota>` is the refused plan's quota and `<used>` the `used_bytes` of the 409, both in the `<size>` format.

**Field errors checked in the browser, before any request.**

| Fields | Field error |
|---|---|
| `Epoch (GMT)`, `Link expiry (GMT)`, `Go to GMT` | `Use GMT day-of-year: YYYY-DDD/HH:MM:SS.` |
| `MET` | `Use a MET like +000:01:00:00 or T-000:00:05:00.` |
| `Latitude` | `Use a latitude like 12.5° S or −12.5.` |
| `Longitude` | `Use a longitude like 45.25° W or −45.25.` |

The minus sign in the two coordinate messages is U+2212. Text-field errors (DP-88) come from the API and show under their field like any other API field error.

**Outage banners.** Each is an `alert`:

| Service | Screens | Banner |
|---|---|---|
| storage | both consoles | `Capture storage is offline. Uploads, deletions and capture downloads are paused; the replay still plays.` |
| search | both consoles | `Transcript search is offline. The track, loupe and transcript still work.` |
| queue | author console | `The parsing queue is offline. Uploads are stored and will be parsed when it returns.` |
| webhooks | author console | `Webhooks are offline. Changes are kept and sent to subscribers when it returns.` |
| billing | Missions page | `Billing is offline. Uploads keep your current quota; plan changes are paused.` |

**Background work leaves the screen alone.** None of the following may close a dialog or drawer, move focus (except under a refresh's focused-result rule), clear the search box, the results, a dialog draft, the landmark form, the subscriber field or the reference field, re-announce a search count (only a refresh announces), stop playback, or change the lens MET, units, checked plan radio or address:
- the 10-second status check
- the once-a-second pass check
- banner changes
- pushed changes
- reader count updates
- plan re-reads

A track reload follows the track-reload rule and pauses playback first; it changes nothing else in this list. An open Pin event dialog keeps its `MET` text, and its heading changes only on Save event.

**Fixed headings and pages.**

| Situation | HTTP status | Heading | Line |
|---|---|---|---|
| Empty mission, author console | 200 | `No passes on this mission yet` | `Upload a capture to draw the first ground track.` |
| Empty mission, share page | 200 | `This replay has no passes yet` | none |
| Withdrawn link | 410 | `This replay link has been withdrawn` | `The author turned this link off. Ask them for a new one.` |
| Expired link | 410 | `This replay link has expired` | `Ask the author for a new link.` |
| Rate-limited link | 429 | `Too many requests for this replay link` | `Wait a minute, then reload.` |
| Unknown link | 404 | `No replay at this link` | none |
| Unknown mission | 404 | `Mission not found` | none |
| Any other unknown non-API path | 404 | `Page not found` | none |

## Backend

### API (DP-01, DP-03, DP-04, DP-08, DP-09, DP-10, DP-20, DP-23, DP-27, DP-28, DP-30, DP-31, DP-34, DP-35, DP-36, DP-38, DP-41, DP-46, DP-47, DP-50, DP-52, DP-54, DP-57, DP-60, DP-64, DP-70, DP-71, DP-72, DP-73, DP-74, DP-82, DP-84, DP-85, DP-87, DP-88, DP-89, DP-90, DP-91, DP-93, DP-94, DP-95, DP-97)

**Formats.**
- All JSON responses use `application/json; charset=utf-8`.
- JSON request bodies are at most 16,384 bytes. Captures are at most 5,000,000 bytes. Both limits are allowed.
- Unknown request members are ignored.
- Ids are UUIDs, except subscriber ids, which are the webhook service's endpoint ids.
- An "ISO instant" is exactly `YYYY-MM-DDTHH:MM:SSZ`: UTC, whole seconds, no fraction and no offset. Every instant the API takes or returns is an ISO instant, never a day-of-year time. Billing dates are `YYYY-MM-DD` as billing gives them.
- Query strings are decoded as `application/x-www-form-urlencoded` (WHATWG URL Standard), so `+` is a space and `%2B` a plus sign.
- Request bodies must be I-JSON (RFC 7493). The body is malformed if it has any of these:
  - a duplicate member name
  - a string or member name holding an unpaired surrogate escape (for example `"\ud800"`)
  - a number with no fraction or exponent part whose magnitude exceeds 2^53 − 1
- Integer fields are JSON integers in every response, never strings or floats. This covers counts, sizes, sums, cents, MET, `met_ms`, frame numbers, versions, audit sequence numbers, line numbers, Unix milliseconds and limits.

**Error shape.**
- Every error body is `{"error":"<code>"}`.
- `validation` adds `"errors":{"<field>":"<message>"}`, listing every failing field.
- The codes below that name extra keys add exactly those keys.
- Error bodies carry exactly the keys listed for that error and no others.
- Unknown `/api/` routes answer JSON. Unknown non-API paths answer the HTML pages in Feedback states.

**Error precedence, for the whole API.** The first rung that applies decides the answer:

| Rung | Applies when | Answer |
|---|---|---|
| 1 | unknown route, mission, pass, link or capture; unknown landmark or subscriber of a known mission | 404 `{"error":"not_found"}`; landmark: 404 `{"error":"landmark_not_found"}`; subscriber: 404 `{"error":"subscriber_not_found"}` |
| 2 | share route, known link over its rate limit | 429 `{"error":"rate_limited"}` (see Share (reader)) |
| 3 | revoked link | 410 `{"error":"link_revoked"}` |
| 4 | expired, unrevoked link | 410 `{"error":"link_expired"}` |
| 5 | deleted pass | 410 `{"error":"pass_deleted"}` |
| 6 | method not allowed | 405 `{"error":"method_not_allowed"}` with `Allow`; share routes `{"error":"read_only"}` with `Allow: GET, HEAD` |
| 7 | body over its limit | 413 `{"error":"body_too_large","limit_bytes":16384}` or the capture 413 under Passes |
| 8 | wrong content type | 415 `{"error":"unsupported_media_type"}` |
| 9 | malformed or non-I-JSON body | 400 `{"error":"invalid_json"}` |
| 10 | request key (uploads and pins) | the request-key answers in Business rules; a replay is returned here, before any later rung |
| 11 | state conflict | 409 with the endpoint's code |
| 12 | validation | 422 `validation` |
| 13 | dependency unreachable or unconfirmed | 503 `{"error":"storage_unavailable"}`, `{"error":"search_unavailable"}`, `{"error":"renderer_unavailable"}`, `{"error":"billing_unavailable"}` or `{"error":"webhooks_unavailable"}` |

Endpoint rows list only their own extra errors. Where one endpoint has several rung-11 conflicts, it lists them in the order they are checked.

**Shapes.**
- **Mission:** `{"id","name","epoch_utc","distance_unit":"km"|"nmi","speed_unit":"m_s"|"ft_s","sample_count","total_bytes","perilune","passes":[Pass],"landmarks":[Landmark],"reference","share","change_version","created_at"}`.
  - `total_bytes` is the sum of `size_bytes` over non-deleted passes.
  - `perilune` is `null` or `{"met","met_label","altitude_m","lat_deg","lon_deg","residual_m"}`.
  - `reference` is `null` (no target set) or a Reference.
  - `share` is the active, unexpired Share link, or `null`.
  - `passes` excludes deleted passes and is in upload order.
  - `landmarks` is in creation order.
- **Reference:** `{"target","state":"fetching"|"ready"|"unavailable","fetched_at","vector_count"}`. `fetched_at` is the ISO instant of the last successful fetch or revalidation, or `null`.
- **Vector:** `{"unix_ms","x_m","y_m","z_m","vx_m_s","vy_m_s","vz_m_s"}`.
- **Share link:** `{"token","url","created_at","expires_utc"}`. `url` is `/s/<token>`.
- **Landmark:** `{"id","name","lat_deg","lon_deg","created_at"}`. Degrees are signed decimal, with north and east positive.
- **Subscriber:** `{"id","url","created_at"}`.
- **Plan:** `{"plan":"archive-free"|"archive-1"|"archive-10-annual","label","price_cents","period":"month"|"year","quota_bytes","used_bytes","next_billing_date","balance_cents","billing":"up"|"down"}`.
  - `label` is the `<plan label>`. `price_cents` is the plan's price per period in integer cents. `quota_bytes` is the plan's quota.
  - `used_bytes` is the sum of `size_bytes` over every non-deleted pass of every mission, including `uploading` and `stored` ones.
  - `next_billing_date` is billing's charged-through date of the subscription, or `null` when there is no subscription or billing is down.
  - `balance_cents` is the billing account's balance in integer cents (negative for a credit), `0` when no account exists, and `null` when billing is down.
- **Pass:** `{"id","mission_id","filename","state":"uploading"|"stored"|"parsed"|"rejected","size_bytes","sha256","sample_count","transcript_line_count","rejected_line","rejected_reason","created_at"}`.
  - `filename` is the decoded, NFC-normalised name.
  - Counts are 0 and the rejection fields `null` until they apply.
- **Sample:** `{"index","pass_id","met","met_label","utc","lat_deg","lon_deg","altitude_m","speed_m_s","residual_m"}`.
- **Line:** `{"id","pass_id","met","met_label","speaker","text"}`.
- **Event:** `{"id","pass_id","met","met_label","title","note","sample":{"lat_deg","lon_deg","altitude_m","speed_m_s","residual_m"}}`. Share responses omit `note`.
- **Frame:** `{"k","met_ms","altitude_m","lat_deg","lon_deg","speed_m_s"}`, values unrounded.
- **Audit entry:** `{"seq","at","kind","data","prev","hash"}`.

**Downloads.**
- Every download answer (capture, event list, dossier) carries `Content-Disposition`. Capture and event list answers also carry a strong `ETag`.
- For the event list, the ETag is the lowercase hex SHA-256 of the exact body, in double quotes.
- The dossier is rendered afresh on every request (its footer carries the current time), so its answers carry no `ETag` guarantee and no `Content-Length` guarantee.

**Health and status**

| Method and path | Answer |
|---|---|
| `GET /api/health` | 200 `{"status":"ok"}`, whatever the state of any dependency other than Postgres |
| `GET /api/status` | 200 `{"storage":"up"\|"down","search":"up"\|"down","queue":"up"\|"down","cache":"up"\|"down","billing":"up"\|"down","webhooks":"up"\|"down"}`, probed live on each call |

**Archive plan**

`GET /api/plan` → 200 Plan. While billing answers, the plan, date and balance are read from billing and the stored plan is brought in line with it. While billing is down, the answer uses the last plan billing confirmed.

`PUT /api/plan` `{"plan"}` → 200 Plan.
- The current confirmed plan → 200 Plan with no billing write.
- A plan whose quota is below `used_bytes` → 409 `{"error":"plan_too_small","quota_bytes":<n>,"used_bytes":<n>}`, with `quota_bytes` the refused plan's quota.
- `plan` must be one of the three plan ids. Otherwise 422 on `plan` `Choose archive-free, archive-1 or archive-10-annual.`
- Billing unreachable, or the change not confirmed within 10 seconds → 503 billing, and the app's plan is unchanged.

**Missions**

`GET /api/missions` → 200 `{"missions":[Mission]}`, oldest first.

`POST /api/missions` `{"name","epoch_utc"}` → 201 Mission. Fields:
- `name`: a text field (Business rules), 1 to 80 characters (both ends allowed). Otherwise 422 `Enter a mission name of 1 to 80 characters.`
- `epoch_utc`: an ISO instant naming a real instant. Otherwise 422 `Enter the epoch as YYYY-MM-DDTHH:MM:SSZ.`

`GET /api/missions/<id>` → 200 Mission.

`PATCH /api/missions/<id>` → 200 Mission. The body is an RFC 7396 JSON Merge Patch with `Content-Type: application/merge-patch+json`; any other content type, `application/json` included, answers 415.
- A body that is not a JSON object → 422 on `body` `Send a JSON object.`
- An absent member is unchanged. Members:
  - `name`: as on create; `null` fails the same check.
  - `distance_unit`: `km` or `nmi`. Otherwise, `null` included, 422 `Choose km or nmi.`
  - `speed_unit`: `m_s` or `ft_s`. Otherwise, `null` included, 422 `Choose m_s or ft_s.`
  - `reference_target`: only `null`, which clears the target, its vectors and every residual. Any other value → 422 `Only null clears the reference target here.`
- If any member fails, nothing changes.

`GET /api/missions/<id>/track` → 200 `{"samples":[Sample]}` in track order.

`GET /api/missions/<id>/frames?from=<met>&to=<met>&fps=<fps>` → 200 `{"fps","frames":[Frame]}`.
- A mission with no parsed samples → 409 `{"error":"mission_has_no_samples"}`.
- Fields, each checked, with every failing one listed:
  - `fps`: `1`, `5`, `10` or `25`. Otherwise 422 `Choose fps 1, 5, 10 or 25.`
  - `from`: an integer from the first sample's MET to the last sample's MET. Otherwise 422 `Give from as whole MET seconds within the track.`
  - `to`: an integer from `from` to the last sample's MET. Otherwise 422 `Give to as whole MET seconds from from to the end of the track.` When `from` fails, `to` is checked only against the track.
  - More than 3,000 frames (3,000 allowed) → 422 on `to` `Ask for at most 3000 frames.`
- Frames follow the frame grid and interpolation in Business rules, in ascending `k`.

`GET /api/missions/<id>/transcript` → 200 `{"lines":[Line]}` in MET order.

`GET /api/missions/<id>/speakers` → 200 `{"speakers":[{"name","lines"}]}` in speaker order.

`GET /api/missions/<id>/events` → 200 `{"events":[Event]}` in MET order.

`POST /api/missions/<id>/events` → 201 Event.
- It requires `Idempotency-Key`. The body is `{"met","title","note"?}`.
- The 201 is sent after the event's search write is confirmed or recorded as pending.
- Fields:
  - `met`: a JSON integer of seconds, negative before the epoch. Anything else, including a MET label or a fraction → 422 `Give MET as a whole number of seconds.` With no sample at or before `met` → 422 `No sample at or before this time.`
  - `title`: a text field, 1 to 120 characters. Commas and quotes are allowed. Otherwise 422 `Enter a title of 1 to 120 characters.`
  - `note`: optional, a text field of at most 2,000 characters. Otherwise 422 `Keep the private note to 2,000 characters or fewer.`

`GET /api/missions/<id>/search?q=<text>` → 200 `{"query","count","hits":[{"kind":"line"|"event","met","met_label","speaker","text"}]}`.
- Event hits have `speaker` `null`, and `text` is the title.
- Hits are in MET order, at most 50. `count` is the number returned.
- `q` must trim to 1 to 200 characters. Otherwise 422 `Enter 1 to 200 characters to search for.`
- Can answer 503 search.

`GET /api/missions/<id>/audit` → 200 `{"entries":[Audit entry]}` in `seq` order.

`GET /api/missions/<id>/audit/verify` → 200 `{"ok":true,"length":<n>}` when every entry's `prev` and `hash` check out, otherwise 200 `{"ok":false,"first_bad_seq":<n>}`.

`GET /api/missions/<id>/stream` → 200 `text/event-stream`, held open (the author stream).
- Messages are `event: readers` with `data: {"readers":<n>}`, or `{"readers":null}` while the cache is unreachable.
- One message is sent on connect, and one whenever the count or its availability changes.
- A comment line is sent whenever 15 seconds pass without one.

`GET /api/missions/<id>/dossier.pdf` → 200, the author dossier in the mission's saved units. Can answer 503 renderer.

**Subscribers**

`GET /api/missions/<id>/subscribers` → 200 `{"subscribers":[Subscriber]}` in creation order.

`POST /api/missions/<id>/subscribers` `{"url"}` → 201 Subscriber.
- Conflicts, in order:
  - the mission already has 3 → 409 `{"error":"subscriber_limit","message":"A mission has at most 3 subscribers."}`
  - the same trimmed URL is already a subscriber → 409 `{"error":"subscriber_exists","message":"This URL is already subscribed."}`
- `url`: trimmed, at most 2,048 characters, an absolute `http` or `https` URL with a host and no user information or fragment. Otherwise 422 `Enter an http or https URL of up to 2048 characters.`
- The subscriber is saved only after the webhook service confirms its endpoint. Unreachable → 503 webhooks, and nothing is saved.

`DELETE /api/missions/<id>/subscribers/<subscriber id>` → 204, and afterwards → 404 `subscriber_not_found`. The endpoint is removed from the webhook service first. Unreachable → 503 webhooks, and the subscriber stays.

**Reference**

`GET /api/missions/<id>/reference` → 200 `{"reference":Reference|null,"vectors":[Vector]}`, vectors ascending by `unix_ms`.

`PUT /api/missions/<id>/reference` `{"target"}` → 200 `{"mission":Mission,"outcome":"updated"|"unavailable"}`.
- A mission with no parsed samples → 409 `mission_has_no_samples`.
- `target`: 1 to 32 of `A`–`Z`, `0`–`9` and `-`. Otherwise 422 `Enter a target of 1 to 32 capital letters, digits or dashes.`
- When the ephemeris service answers `unknown_target` → 422 on `target` `The ephemeris service does not know this target.`, and the mission's previous reference is unchanged.

`POST /api/missions/<id>/reference/refresh` → 200 `{"mission":Mission,"outcome":"updated"|"unchanged"|"unavailable"}`.
- No target set → 409 `{"error":"no_reference_target"}`.
- No parsed samples → 409 `mission_has_no_samples`.

**Landmarks**

`POST /api/missions/<id>/landmarks` `{"name","lat_deg","lon_deg"}` → 201 Landmark.
- The mission already holds 5 → 409 `{"error":"landmark_limit","message":"A mission holds at most 5 landmarks."}`.
- A name matching an existing one under the rule in Business rules → 409 `{"error":"landmark_name_taken","message":"A landmark with this name already exists."}`. The limit is checked before the name.
- Fields:
  - `name`: a text field, 1 to 40 characters. Otherwise 422 `Enter a landmark name of 1 to 40 characters.`
  - `lat_deg`: a JSON number from −90 to 90 (both allowed), unchanged when rounded to 6 decimals. Otherwise 422 `Give latitude in degrees from -90 to 90, with at most 6 decimals.`
  - `lon_deg`: a JSON number above −180 and up to 180, unchanged when rounded to 6 decimals. Otherwise 422 `Give longitude in degrees above -180 and up to 180, with at most 6 decimals.`

`DELETE /api/missions/<id>/landmarks/<landmark id>` → 204, and afterwards → 404 `landmark_not_found`.

**Passes**

`POST /api/missions/<id>/passes` → 202 Pass in state `stored`.
- The body is the raw capture bytes with `Content-Type: application/octet-stream`. `Idempotency-Key` is required.
- `X-Capture-Filename` is the name as RFC 3986 percent-encoded UTF-8:
  - the raw value holds only bytes 0x21 to 0x7E, and every `%` starts a valid triplet
  - the decoded octets are valid UTF-8, and after NFC they give 1 to 120 code points
  - no control characters (U+0000–U+001F, U+007F–U+009F), `/` or `\`
  - anything else, including any raw byte above 0x7E → 422 on `filename` `Send the capture name percent-encoded as UTF-8: 1 to 120 characters, no control characters, slashes or backslashes.`
- `X-Capture-SHA256` is 64 lowercase hex characters. Otherwise 422 on `sha256` `Send the capture's SHA-256 as 64 lowercase hex characters.`
- The 202 is sent only after storage confirms. It never waits for the parse queue.
- Errors:
  - empty body → 422 on `body` `The capture is empty.`
  - checksum mismatch → 422 on `sha256` `The SHA-256 does not match the bytes received.`
  - over the limit → 413 `{"error":"capture_too_large","limit_bytes":5000000}`
  - rung-11 conflicts, in order:
    - the same bytes as a non-deleted pass of this mission, whatever the name → 409 `{"error":"duplicate_capture","pass_id":"<existing id>"}`
    - `used_bytes` plus this capture's size would exceed the plan's quota → 409 `{"error":"quota_exceeded","quota_bytes":<n>,"used_bytes":<n>}`, with `used_bytes` as before this upload
  - 503 storage

`GET /api/passes/<id>` → 200 Pass.

`DELETE /api/passes/<id>` → 204.
- An `uploading` or `stored` pass → 409 `{"error":"pass_not_settled","state":"<state>"}`.
- Can answer 503 storage or 503 search.

`GET` and `HEAD /api/passes/<id>/capture` → the stored capture.
- An `uploading` pass → 409 `pass_not_settled`.
- Can answer 503 storage. While storage is unreachable, every capture request gets this answer, whatever its conditional or range headers.
- The representation is the exact stored bytes. A full answer is 200 with these headers and no `Last-Modified`:
  - `Content-Type: application/octet-stream`
  - `Content-Length`
  - `Accept-Ranges: bytes`
  - `ETag: "<sha256>"`: strong, the pass's lowercase hex SHA-256
  - `Repr-Digest: sha-256=:<base64>:` (RFC 9530): standard padded base64 of the 32-byte SHA-256 of the full stored bytes. It is carried on every answer that has representation headers, 206 included.
  - `Content-Disposition` per RFC 6266: `attachment; filename="<fallback>"`. Whenever the name holds anything outside printable ASCII, it also has `; filename*=UTF-8''<value>` (RFC 8187). `<fallback>` is the name with `_` replacing every code point outside U+0020–U+007E and every `"`, `\` and `%`.
- Conditional and range requests follow RFC 9110, in this evaluation order. The first step that applies decides the answer:
  1. `If-Match` that does not match under strong comparison → 412 `{"error":"precondition_failed"}`.
  2. `If-None-Match` that matches under weak comparison (`*` included) → 304 with `ETag` and no body.
  3. `If-Range` that does not match the ETag under strong comparison → `Range` is ignored and the answer is 200 with the full body. This is decided before range satisfiability, so a mismatching `If-Range` with an unsatisfiable `Range` answers 200, never 416. `If-Range` without `Range` is ignored.
  4. A `Range` in another unit or with invalid syntax is ignored (200 with the full body).
  5. A single byte range (`bytes=a-b`, `bytes=a-`, `bytes=-n`) that is satisfiable → 206 with `Content-Range: bytes <first>-<last>/<size>` and exactly those bytes. A last position past the end is clamped.
  6. An unsatisfiable single range → 416 `{"error":"range_not_satisfiable"}` with `Content-Range: bytes */<size>`.
  7. More than one range → 200 with the full body, or 206 `multipart/byteranges`.
- HEAD answers exactly the status and headers GET would answer for the same request headers, including 206, 304, 412 and 416, with an empty body.

**Sharing (author)**

`POST /api/missions/<id>/share` → 201 Share link. Any active link is revoked in the same step.
- The body is empty, or `application/json` `{"expires_utc"?}`.
  - A non-empty body with another content type → 415.
  - A non-empty JSON body that is malformed → 400.
- A malformed `expires_utc` → 422 on `expires_utc` `Send the expiry as YYYY-MM-DDTHH:MM:SSZ.`
- A well-formed `expires_utc` must be strictly after the server's now and at most 31,536,000 seconds after it (allowed). Otherwise 422 `Choose an expiry after now and within 365 days.`

`DELETE /api/missions/<id>/share` → 204. With no active, unexpired link → 404 `{"error":"no_active_link"}`.

**Share (reader).** Every route takes `<token>`.

- Only GET and HEAD are allowed. Any other method on `/api/share/...` or `/s/...` answers rung 6 `read_only` and changes nothing.
- HEAD answers the GET status and headers with no body, except on `dossier.pdf` (see Dossier answers).
- No share route exposes the audit log.

**Rate limit.** Each known token has one budget, shared across every share route and every app instance:
- At most 120 counted requests in any rolling 60 seconds. A request at time t counts against the requests counted after t − 60 s.
- Every request for a known token counts, whatever its answer, except one answered 429.
- Every counted answer carries `RateLimit-Policy: 120;w=60` and `RateLimit: limit=120, remaining=<n>, reset=<s>`:
  - `<n>` is 120 minus the counted requests in the window, this one included.
  - `<s>` is the whole seconds until the oldest counted request leaves the window, rounded up and at least 1.
- Over the budget → 429 `{"error":"rate_limited"}` (the HTML page for `/s/<token>`), with `Retry-After: <s>` and the same two fields showing `remaining=0`.
- While the cache is unreachable, share routes are served without a limit and without these fields.

**Share routes.**

`GET /s/<token>` → 200 HTML console. Revoked, expired, rate-limited and unknown links answer with the HTML pages in Feedback states.

`GET /api/share/<token>` → 200 with this body. Parsed passes only.

```json
{"mission":{"name","epoch_utc","distance_unit","speed_unit","sample_count","perilune","reference","change_version"},"passes":[{"id","filename","size_bytes","sha256","sample_count","transcript_line_count"}],"landmarks":[Landmark],"expires_utc"}
```

`GET /api/share/<token>/track`, `/transcript`, `/speakers`, `/events` and `/frames` → the author shapes and rules, without `note`.

`GET /api/share/<token>/search?q=` → as the author search, scoped to the link's mission.

`GET /api/share/<token>/stream` → 200 `text/event-stream`, held open.
- Each message is `event: mission-changed`, `id: <v>`, `data: {"version":<v>}`, where `<v>` is a mission change version. Messages carry nothing else.
- Without `Last-Event-ID`, the first message carries the current version.
- With `Last-Event-ID: <n>`, where n is an integer from current − 1,000 to current, the stream first sends one message for each version from n+1 to current, in order. It sends nothing first when n equals current.
- Any other `Last-Event-ID` gets one message with the current version.
- After that, one message per later version, in order.
- A comment line starting with `:` is sent whenever 15 seconds pass with nothing else sent.
- The stream ends after the revocation's message, and at `expires_utc`.
- An open stream is a reader, as Services defines.

`GET` and `HEAD /api/share/<token>/captures/<pass id>` → exactly as the author capture route, for parsed passes only. Any other pass id → 404.

`GET /api/share/<token>/events.csv?distance=<km|nmi>&speed=<m_s|ft_s>` → 200 CSV per RFC 4180.
- Headers: `Content-Type: text/csv; charset=utf-8; header=present` and `Content-Disposition: attachment; filename="events.csv"`.
- UTF-8 with no byte-order mark. Every record, the last included, ends with CRLF.
- The header record is `met_label,met_seconds,title,altitude_<km|nmi>,speed_<m_s|ft_s>,residual_<km|nmi>`. Then one record per event, in MET order.
- Altitude, speed and residual are the formatted numbers without unit text. The residual cell is empty when the event's sample has none.
- Formula neutralisation and quoting:
  1. A text cell (`met_label`, `title`) whose first character is `=`, `+`, `-`, `@`, TAB or CR is first prefixed with one `'`.
  2. Then any cell containing `,`, `"`, CR or LF is wrapped in double quotes, with inner quotes doubled.
  - Numeric cells are never prefixed and keep a leading `-`.
  - A `T-` label is unchanged.
  - The apostrophe exists only in the CSV.
- A missing unit parameter takes the saved unit. A bad `distance` → 422 `Choose km or nmi.` A bad `speed` → 422 `Choose m_s or ft_s.`

`GET /api/share/<token>/dossier.pdf?distance=&speed=` → 200, the share dossier. Unit parameters work as for the CSV. Can answer 503 renderer.

**Dossier answers (both routes).**
- 200 `Content-Type: application/pdf`.
- `Content-Disposition` names `<mission name>-dossier.pdf`, built under the capture route's RFC 6266 and RFC 8187 rule.
- If the renderer is unreachable or has not answered within 10 seconds → 503 renderer.
- HEAD on either dossier route answers 200 with the same `Content-Type` and `Content-Disposition` as GET and no body, without rendering. It carries no `ETag` or `Content-Length` guarantee, and a HEAD answer need not equal a GET answer in those headers. HEAD on a dossier route still follows the error precedence, and answers 503 renderer when the renderer is unreachable.

### Business rules (DP-03, DP-07, DP-08, DP-09, DP-10, DP-13, DP-14, DP-16, DP-17, DP-20, DP-22, DP-23, DP-27, DP-28, DP-30, DP-34, DP-39, DP-46, DP-47, DP-48, DP-50, DP-51, DP-52, DP-53, DP-54, DP-56, DP-57, DP-58, DP-59, DP-60, DP-61, DP-62, DP-64, DP-65, DP-66, DP-68, DP-71, DP-73, DP-74, DP-75, DP-79, DP-80, DP-85, DP-88, DP-90, DP-91, DP-94, DP-95, DP-98)

**Several instances.**
- Several app instances may run at once against one database, bucket, index, broker, cache, billing tenant and webhook organisation. Some of them may have one dependency unreachable.
- Every rule here holds across all instances. That includes each "exactly one" rule, the quota, stream delivery, webhook delivery, the audit chain, the rate limit and the reader count.
- A change made through one instance reaches readers streaming from any other. State held only in one process's memory is not enough.

**Characters.** Character counts are Unicode code points. "Trimmed" means leading and trailing white space is removed, with ECMAScript `String.prototype.trim` semantics. User text (speakers, landmark names, titles, URLs) is ordinary data whatever it spells, including `__proto__`, `constructor`, `toString`, `hasOwnProperty` and `valueOf`: nothing is dropped, merged or inherited, and one mission's text never changes another mission's answers.

**Text fields.** Mission names, event titles, private notes and landmark names are text fields:
1. The raw value, before trimming, is checked first. Any character of Unicode general category `Cc` (U+0000–U+001F and U+007F–U+009F, including U+0085), U+2028 LINE SEPARATOR or U+2029 PARAGRAPH SEPARATOR → 422 on that field `Remove control characters and line or paragraph separators.`
2. The value is then trimmed and NFC-normalised, and that form is stored and counted against the field's length rule.
- Other format characters are allowed, so a U+200D ZERO WIDTH JOINER inside an emoji sequence is ordinary text and counts as one code point.

**Day-of-year time.**
- The form is exactly `YYYY-DDD/HH:MM:SS`, with nothing before or after it:
  - `DDD` has three digits. 1 January is `001`. The last day is `366` in a leap year and `365` otherwise.
  - Hours run `00`–`23`. Minutes and seconds run `00`–`59`.
- The instant is 1 January of `YYYY` at 00:00:00 UTC, plus `DDD − 1` days, plus the time. The browser time zone never takes part, in either direction.
- `<gmt>` (the lens sample's UTC), `<epoch_gmt>`, `<expires_gmt>` and `<now_gmt>` (the server's now) use this form.
- For example, `2028-061/00:00:30` is `2028-03-01T00:00:30Z`, and `2028-366/23:59:59` is `2028-12-31T23:59:59Z`.

**Typed MET.**
- The form is `+DDD:HH:MM:SS` (zero or later) or `T-DDD:HH:MM:SS` (before the epoch), with nothing before or after it.
- `DDD` has three or more digits. Hours run `00`–`23`. Minutes and seconds run `00`–`59`.
- Its value is `DDD·86,400 + HH·3,600 + MM·60 + SS`, negated for `T-`.
- The API receives only those seconds. The snapping rule sets the event's MET.

**Typed coordinates.**
- After trimming, a coordinate is a decimal number (digits, optionally followed by `.` and 1 to 6 digits), optionally followed directly by `°`, then one of:
  - a hemisphere letter, with optional spaces before it: `N`/`S` for latitude, `E`/`W` for longitude, either case. The number must then be unsigned. `S` and `W` make it negative.
  - nothing. The number may then begin with one sign: ASCII `-` or U+2212 `−`.
- These are malformed: a sign together with a letter, the other axis's letter, and anything else.
- Latitude must lie from −90 to 90. Longitude must be above −180 and up to 180. A value outside fails the same check.

**Request keys (uploads and pins).**
- Both POST routes require an `Idempotency-Key` of 1 to 64 letters, digits or `-`. A missing or malformed key answers at rung 10: 422 `validation` with only the field `idempotency_key` `Send an Idempotency-Key of 1 to 64 letters, digits or dashes.`
- A key belongs to one mission and one route.
- Key lifecycle:
  - absent → in progress when its request begins
  - in progress → kept on a 201 or 202
  - in progress → absent on any 4xx or 503
  - a kept key lasts as long as its mission
- "The same request" means:
  - upload: the same `X-Capture-SHA256` and the same decoded NFC filename
  - pin: the same `met`, trimmed `title` and trimmed `note`, where an absent note equals an empty one
- At rung 10, these checks run in order:
  1. The key is in progress → 409 `{"error":"idempotency_request_in_progress"}`.
  2. The key is kept with a different request → 422 `{"error":"idempotency_key_reused"}`.
  3. The key is kept with the same request → the original status with the pass or event as it is now, plus `Idempotency-Replayed: true`. Nothing is written or queued, no audit entry, webhook or alert is created, and the version does not change. If the pass has since been deleted → 410 `pass_deleted`.
- First answers never carry `Idempotency-Replayed`.
- Of simultaneous requests with one key, exactly one proceeds and the rest answer in progress.
- The duplicate-capture and quota checks run after the replay check.

**Pass state machine.**
- **`uploading` → `stored`.** This happens only after storage acknowledges the write and the object read back from storage hashes to both the declared checksum and the bytes received.
  - In the same database transaction as this transition, the pass is queued for parsing (Services, outbox) and its `pass.stored` audit entry is appended. Only then is the 202 sent.
  - Any write failure, unreachable storage or hash difference removes any partial object and the pass record, and returns the key to absent. The answer is as in API, and no pass stays `uploading`.
- **`stored` → `parsed` or `rejected`.** This happens only when a parse job for the pass is consumed from the parse queue.
  - The pass becomes `parsed` when every line parses and its search documents are confirmed or pending.
  - Otherwise it becomes `rejected`, with `rejected_line` and `rejected_reason`.
  - A parse writes all its samples and lines, the version increase, the audit entry and the webhook's outbox row in one transaction.
  - A job for a pass that is no longer `stored` writes nothing and sends nothing.
- **Parser failure.** A sample whose x, y and z are all zero has no latitude. Reaching one, or any other unexpected parser error, is a parser failure, not a line rejection.
  - The job is redelivered until the parse queue's delivery limit dead-letters it.
  - The pass then becomes `rejected` with `rejected_reason` `parser_failed` and `rejected_line` `null`.
- **Storage unreachable at parse time.** A parse job whose object cannot be read because storage is unreachable is neither a parser failure nor a line rejection.
  - The pass stays `stored`, nothing is written, and the version does not change.
  - The consumer acknowledges that delivery and clears `sent_at` on the job's outbox row. The relay then publishes the job again, as a new message with a fresh delivery count, within `DEPENDENCY_RETRY_SECONDS` seconds. The delivery limit never dead-letters a job because storage was down.
  - The pass parses once storage answers, with no restart.
- **Parse budget.**
  - While the parse queue is up, any capture up to the size limit settles within 10 seconds of its 202. That includes a single 5,000,000-byte line and 50,000 samples.
  - A parser failure settles within 30 seconds.
  - Passes stored while the queue is down settle within 10 seconds of it answering, in the order they became `stored`.
  - Passes waiting on storage settle within 10 seconds plus `DEPENDENCY_RETRY_SECONDS` seconds of storage answering.
- **`parsed` or `rejected` → `deleted`.** Deleting an `uploading` or `stored` pass → 409 `pass_not_settled`.
- No other transition exists. There is no re-parse.

**Races.**

| Simultaneous requests | Outcome |
|---|---|
| uploads of the same bytes under different keys | exactly one 202; the rest 409 `duplicate_capture` |
| uploads, on any missions, whose sizes together would exceed the quota | uploads are admitted one at a time against `used_bytes` including earlier admitted ones; each that still fits answers 202, each that no longer fits 409 `quota_exceeded` |
| deletions of one pass | exactly one 204; the rest 410 |
| share creations | all 201; exactly one token active afterwards |
| landmark additions to a mission holding 4 | exactly one 201; the rest 409 `landmark_limit` |
| subscriber additions to a mission holding 2 | exactly one 201; the rest 409 `subscriber_limit` |
| reference sets, refreshes or clears of one mission | they run one after another |
| plan changes | they run one after another |
| any changes to one mission | their audit entries get consecutive `seq` values with no gap or repeat |

**Storage quota.**
- `used_bytes` counts every non-deleted pass from the moment its upload is admitted as `uploading`. A refused or failed upload frees its bytes at once. A deleted pass frees its bytes in the deletion's transaction.
- An upload is admitted when `used_bytes + size ≤ quota_bytes`. Reaching the quota exactly is allowed.
- The quota is that of the last plan billing confirmed. It never depends on billing being reachable at upload time.

**Archive plan.**
- `<plan label>`: `Free`, `Archive 1 GiB` or `Archive 10 GiB`.
- `<plan price>`: `Free`, `4.00 USD/month`, or `24.00 USD/month, billed 288.00 USD yearly`. The monthly figure of a yearly plan is its price in cents divided by 12, rounded half away from zero to whole cents.
- `<money>` is integer cents written as whole units, `.`, and exactly two digits, with a leading hyphen-minus when negative. It is computed from integer cents only.
- `<balance>` is `<money>` of `balance_cents` followed by ` USD`, or `—` (U+2014) when it is `null`.
- `<next invoice>` is `next_billing_date` as `YYYY-MM-DD`, or `—` when it is `null`.
- `<size>`, used for `<used>` and `<quota>`: with 1 KiB = 1,024 bytes, 1 MiB = 1,048,576 bytes and 1 GiB = 1,073,741,824 bytes, the bytes are shown in the largest of GiB, MiB and KiB whose value is at least 1, with one decimal rounded half away from zero, a space and the unit. Below 1 KiB they are shown as `<n> B`. Decimal units (kB, MB, GB) are never used.
- Billing amounts are decimal major units. They become integer cents by exact decimal conversion, never by binary floating-point arithmetic.
- Price, quota and next invoice date shown to the author come from the plan answer, never from the browser's own arithmetic.

**Capture line format.**
- Lines are separated by LF. A trailing CR is dropped, and a final newline adds no line.
- Line numbers start at 1 and count every line.
- A UTF-8 byte-order mark (EF BB BF) at byte 0 is skipped by the parser and kept in the stored object. Line 1 is still line 1, and the mark does not count toward its length.
- Each line is checked in this order:
  1. **Length.** At most 1,024 bytes (allowed), excluding the LF and a dropped CR. This includes comments and blank lines.
  2. **Comment or blank.** A line starting with `#`, an empty line, or a line of only spaces and tabs is ignored.
  3. **Stray mark.** Any other line containing EF BB BF is unreadable.
  4. **Record type.** The text before the first comma must be `S` or `T`.
  5. **Sample cap.** At most 50,000 samples (allowed). The 50,001st `S` line is rejected here.
  6. **Fields.**
     - `S,<utc>,<x_m>,<y_m>,<z_m>,<vx_m_s>,<vy_m_s>,<vz_m_s>` has exactly 8 fields, in Moon-centred Moon-fixed metres and metres per second. x points toward latitude 0°, longitude 0°, and z toward north.
     - `T,<utc>,<speaker>,<text>` has a speaker of 1 to 40 characters. The text is everything after the third comma, 1 to 500 characters.
     - Every field is valid UTF-8, and `<utc>` is a real ISO instant.
     - Numbers are an optional `-`, digits, and optionally `.` followed by digits.
  7. **Order.** Each sample's UTC is strictly after the previous sample's.
- A capture needs at least one sample.
- The first failing line decides the outcome:

| Reason code | Reason text | When |
|---|---|---|
| `line_too_long` | `line is longer than 1024 bytes` | step 1 |
| `unknown_record` | `unknown record type` | step 4 |
| `too_many_samples` | `more than 50000 samples` | step 5 |
| `bad_field` | `a field cannot be read` | step 3 or 6 |
| `out_of_order` | `sample time is not after the previous sample` | step 7 |
| `no_samples` | `no sample lines` | no sample; the line number is one past the last line |
| `parser_failed` | `the parser stopped unexpectedly` | parser failure; no line number |

**Stored original.** The object is exactly the uploaded bytes and is never normalised. Parsing works on a copy, and every download serves these bytes.

**Derived values.** These are computed once at parse time and stored with each sample. API values match them to within 0.001.
- `r = √(x² + y² + z²)`
- latitude = `atan2(z, √(x² + y²))`
- longitude = `atan2(y, x)`, above −180 and up to 180
- altitude = `r − 1,737,400` m
- speed = `√(vx² + vy² + vz²)`

The **perilune** is the lowest-altitude parsed sample. On a tie, it is the earliest by MET. It is recomputed on each parse or delete.

**Playback frames.**
- **Grid.** For `from`, `to` (whole MET seconds) and `fps`, frame `k` (from 0) sits at `met_ms = from·1000 + round_half_even(k·1000/fps)`, for every `k` with `met_ms ≤ to·1000`.
- **Bracketing.** For a frame at MET t = `met_ms`/1000 seconds, a is the last sample in track order whose MET is at or before t, and b is the next sample after a in track order.
- **Hold.** With no b, or when b's MET minus a's MET exceeds 600 seconds, the frame holds a: its values are a's stored values.
- **Cubic Hermite interpolation** otherwise. With p = (x, y, z) in metres and v = (vx, vy, vz) in metres per second from the stored samples, h = b.MET − a.MET in seconds and s = (t − a.MET)/h:
  - `p(t) = (2s³ − 3s² + 1)·pa + (s³ − 2s² + s)·h·va + (−2s³ + 3s²)·pb + (s³ − s²)·h·vb`
  - `v(t) = ((6s² − 6s)·pa + (3s² − 4s + 1)·h·va + (−6s² + 6s)·pb + (3s² − 2s)·h·vb) / h`
- Frame latitude, longitude and altitude come from p(t) under the derived-value formulas, and speed is the magnitude of v(t).
- API frame values are within 0.01 m, 0.01 m/s and 0.0001° of this computation. The console's playback shows these values under the display formats.

**Speakers.** For each distinct speaker string among the mission's transcript lines (exact code-point equality, no folding), `lines` is its line count. The order is `lines` descending, then `name` ascending by Unicode code point (not UTF-16 code unit).

**Residual.**
- With a `ready` reference, a sample's `residual_m` is the Euclidean distance in metres between its position (x, y, z) and the reference position at its UTC.
- The reference position is interpolated linearly, component by component, between the two adjacent vectors whose `unix_ms` bracket the sample's UTC in milliseconds. A vector at exactly that time is used as is.
- `residual_m` is `null` before the first vector, after the last, and whenever the reference is absent or not `ready`.
- Residuals are recomputed when the reference changes, and computed at parse time for new samples. Samples outside the stored span stay `null` until a refresh covers them.
- `<residual>` uses the `<altitude>` format. While the mission has a reference, a `null` residual shows as `ΔR —` (U+2014) on the plate and in the dossier. Without a reference, the `ΔR` line is absent from both. The CSV cell is empty whenever the residual is `null`.

**Reference state.**
- `<reference line>` is one of:
  - `No reference target` when none is set
  - `Reference <target>: ready, <vector_count> vectors`
  - `Reference <target>: unavailable`
  - `Reference <target>: fetching` while a fetch runs
- A failed fetch sets `unavailable`, and any stored vectors go unused.
- A later refresh answered 304 restores `ready` with the stored vectors.
- Clearing the target removes the reference and its vectors.

**Landmark range.**
- The haversine great-circle distance on a sphere of radius 1,737,400 m, between the lens sample's stored latitude and longitude and the landmark's.
- It is display-only, shown as `<range>` in the `<altitude>` format.
- Landmarks are never indexed and never appear in the CSV, webhooks or push alerts.

**Landmark names.**
- Stored as text fields.
- Two names are the same if they match under Unicode canonical caseless matching (Unicode Standard section 3.13, D145) with full case folding (`CaseFolding.txt` statuses C and F).
- A mission holds at most 5 landmarks. Landmarks cannot be edited, and pass deletion leaves them alone.

**Mission elapsed time.**
- `met` is the item's UTC minus the epoch, in whole seconds, computed on the server.
- `<met_label>` is `+DDD:HH:MM:SS`, or `T-DDD:HH:MM:SS` of the absolute value when `met` is negative. Days have at least three digits.
- Each event takes its snapped sample's MET.

**Track order and snapping.**
- **Track order:** by MET, then pass upload order, then line order. `index` counts from 0 in this order.
- **MET order for lines and hits:** by MET. At equal MET, lines come before events, then pass upload order, then line order. Events at equal MET go by creation time.
- **Snapping:** a line, event, hit, Go to GMT time, `t` or playback frame is placed at the last sample in track order whose MET is at or before it, or at the first sample if there is none. Pins are refused instead, as in API.
- **Current line:** the last line in MET order at or before the lens sample's MET.
- **Track reload:** when a pass is parsed or deleted:
  - playback pauses
  - the lens moves to the last sample at or before its previous MET, or to the first sample
  - the slider value becomes that sample's new index
  - the address keeps its `t`

**Display formats.** The readout, slider value text, Events table, Landmarks list, perilune summary, share page, CSV and dossier always agree.
- Factors are exact: 1 nmi = 1,852 m and 1 ft = 0.3048 m.
- Rounding:
  - Convert from the stored SI value, then round half away from zero. This holds for values whose decimal is exactly half-way, such as an altitude of exactly 100,050 m, which shows as `100.1 km`.
  - A result that rounds to zero has no minus sign.
  - Negative values use the ASCII hyphen-minus.
- `<altitude>`, `<range>` and `<residual>`: one decimal, a space, then `km` or `nmi`.
- `<speed>`: a whole number, a space, then `m/s` or `ft/s`.
- `<latitude>`: the absolute value to two decimals, `°`, a space, then `N` or `S`. `<longitude>` is the same with `E` or `W`. A rounded zero takes `N` or `E`, and 180 takes `E`.
- Numbers have no thousands separators.
- Other placeholders:
  - `<filename>`: the stored decoded NFC name
  - `<query>`: the trimmed search text
  - `<mission name>`, `<landmark name>`, `<target>`, `<speaker>` and `<subscriber url>`: as stored
  - `<lines>` in the Speakers list: the speaker's line count
  - `<reason text>`: from the reason table
  - `<readers>`: the reader count, or `unknown` while the cache is unreachable
  - `<retry_seconds>`: the `Retry-After` value

**Saved units.**
- New missions start in `km` and `m_s`. The author's radios save changes.
- The share page opens in the units in its address, otherwise in the saved units.
- A reader's radios change only that reader's view, address and download links.

**Events.** An event belongs to the pass of its snapped sample. Events cannot be edited or deleted, and they go with their pass.

**Private notes.**
- A note is returned only by author event routes. It is shown only in the author console's Note cell, the open Pin event dialog and the author dossier.
- It never appears in any of these:
  - share HTML, including inline data and scripts
  - share API responses
  - share stream messages
  - the share dossier
  - any search response or the search index
  - the CSV
  - the audit log
  - any webhook payload or push alert
  - `document.title`
  - any `title`, `aria-*` or `data-*` attribute
  - disc pin labels or the lens readout on either console
  - the share page's local storage, session storage or IndexedDB
  - any response header

**Mission change version.**
- `change_version` starts at 0. It rises by exactly one, in the same database transaction as the change, for each of these:
  - an event pinned (first answers only)
  - a pass reaching `parsed`
  - a pass reaching `rejected`, including `parser_failed`
  - a pass deleted
  - a landmark added or removed
  - a reference set (any 200)
  - a refresh with outcome `updated`, or one that changes the reference state
  - a patch that changes the name or clears an existing reference target (one increase per request)
  - a share link created, replaced or revoked
- Nothing else changes it. These leave it unchanged: seeding (including the seed pass reaching `parsed`), uploads reaching `stored`, redelivered parses, unit-only patches, subscriber changes, plan changes, replays and refused requests.
- Each increase reaches every open stream of the mission's active link within 2 seconds, from any instance.
- An open share page shows the change, or the withdrawn page, within 5 seconds of the change's answer.
- An open share page shows the expired page within 5 seconds of `expires_utc`.

**Webhooks per change.** Some version increases also send one webhook, whose event id is `<mission id>:<change_version>` with the version that change produced:

| Change | Event type |
|---|---|
| event pinned | `event.pinned` |
| pass reaching `parsed` | `pass.parsed` |
| pass reaching `rejected`, including `parser_failed` | `pass.rejected` |
| pass deleted | `pass.deleted` |
| share link revoked, or replaced (which revokes the previous link) | `share.revoked` |

Landmark, reference, patch and first-link changes send none. The outbox row for the webhook is written in the change's own transaction, so a change refused or rolled back sends nothing.

**Mission audit.**
- Every change below appends exactly one entry, in the same database transaction as the change. A refused, rolled-back, replayed or redelivered request appends nothing.

| Change | `kind` | `data` |
|---|---|---|
| mission created | `mission.created` | `{"name","epoch_utc"}` |
| patch that changes something | `mission.updated` | the members whose value changed, with their new values (`reference_target` as `null`) |
| pass reaching `stored` | `pass.stored` | `{"pass_id","filename","size_bytes","sha256"}` |
| pass reaching `parsed` | `pass.parsed` | `{"pass_id","sample_count","transcript_line_count"}` |
| pass reaching `rejected` | `pass.rejected` | `{"pass_id","rejected_line","rejected_reason"}` |
| pass deleted | `pass.deleted` | `{"pass_id"}` |
| event pinned | `event.pinned` | `{"event_id","pass_id","met","title"}` |
| landmark added | `landmark.added` | `{"landmark_id","name","lat_deg","lon_deg"}` |
| landmark removed | `landmark.removed` | `{"landmark_id"}` |
| reference set (any 200) | `reference.set` | `{"target","state","vector_count"}` |
| refresh that raises the version | `reference.refreshed` | `{"target","state","vector_count"}` |
| share link revoked, including by replacement | `share.revoked` | `{}` |
| share link created, including by replacement (after its `share.revoked`) | `share.created` | `{"expires_utc"}` |
| subscriber added | `subscriber.added` | `{"subscriber_id","url"}` |
| subscriber removed | `subscriber.removed` | `{"subscriber_id"}` |

- `seq` counts from 1 per mission with no gaps. `at` is the change's commit time as an ISO instant (truncated to the whole second). `prev` is the previous entry's `hash`, or 64 zeros for `seq` 1.
- `hash` is the lowercase hex SHA-256 of the UTF-8 bytes of the RFC 8785 (JCS) canonical JSON of `{"seq","at","kind","data","prev"}`.
- Hashing an entry exactly as the audit route returns it reproduces its `hash`, now and after any later change. Earlier entries never change.
- No entry holds a note, a share token or a request key. Link expiry appends nothing.

**Readers.**
- A reader is an open share stream. The count is the number of open share streams of the mission across all instances.
- It rises within 5 seconds of a stream opening.
- It falls within 5 seconds of a clean close, and within 35 seconds of a connection lost without a close.

**Deleting a pass.**
- Deletion is all or nothing. It removes:
  - the pass's samples, lines and events
  - its pending search writes and its parse outbox rows, in the same transaction as the rows
  - its index documents, confirmed by the engine
  - its object

  It then marks the pass `deleted`.
- Storage is checked before search:
  - storage unreachable → nothing is removed, and the answer is 503 storage
  - search unreachable or unconfirmed → nothing is removed, and the answer is 503 search. Any document the index dropped anyway is restored through the pending search writes.
- A refused deletion leaves every row, the object (byte-identical), every index document, the version, the audit log, every stream and every subscriber unchanged.
- After a deletion:
  - the pass's direct routes answer 410, and its share capture route answers 404
  - its items are absent from every track, frames, transcript, speakers, events, search, CSV and dossier response
  - counts, `total_bytes`, `used_bytes`, the perilune and residuals exclude it
  - the index holds no document with its `pass_id`, then or later

**Share links.**
- A token is at least 32 characters of letters, digits, `-` and `_`, drawn from at least 128 random bits. It grants read access to one mission.
- States: active → revoked, and active → expired. Both are terminal.
- At most one link per mission is active. Creating a link revokes the previous one.
- `created_at` is truncated to the whole second. The default expiry is `created_at` plus exactly 2,592,000 seconds.
- A revoked link answers `link_revoked` from the very next request.
- At or after `expires_utc`, by the server's clock, every share route answers `link_expired`. Revocation takes precedence.
- Once a link has expired, `mission.share` is `null` and the author DELETE answers `no_active_link`.
- Every share response is computed fresh.

### Services (DP-03, DP-08, DP-23, DP-34, DP-36, DP-37, DP-38, DP-39, DP-45, DP-49, DP-54, DP-64, DP-68, DP-77, DP-78, DP-79, DP-80, DP-81, DP-82, DP-83, DP-84, DP-87, DP-89, DP-90, DP-91, DP-93, DP-97, DP-98, DP-99)

**Postgres** (`DATABASE_URL`).
- It holds:
  - missions, with saved units, reference target, reference state and change version
  - passes
  - samples, with SI values, derived values and residuals
  - transcript lines
  - events, with notes
  - landmarks
  - reference vectors
  - request keys, with state, fingerprint and stored answer
  - share links, with expiry and revocation
  - subscribers
  - the last confirmed Archive plan
  - the mission audit entries
  - pending search writes
  - the outbox
- It also carries change notices between instances.
- The schema is applied idempotently on every start.
- The outbox is table `outbox`, with columns `id` (uuid), `kind` (`pass.parse` or `webhook.send`), `pass_id` (uuid, set for `pass.parse`), `event_id` (text, set for `webhook.send`), `payload` (the webhook payload, set for `webhook.send`), `created_at`, `sent_at` and `delivered_at` (set when the webhook service accepted the message).
  - A `pass.parse` row is written in the transaction that makes its pass `stored`. A `webhook.send` row is written in the transaction of the change it reports.
  - `sent_at` stays null until the broker confirms the publish.
  - `pass.parse` rows are kept until their pass is deleted. `webhook.send` rows are kept.

**Object storage** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
- One object per non-deleted pass, at `captures/<mission id>/<pass id>.cap`, with content type `application/octet-stream`.
- The browser never talks to storage.

**Search** (`MEILISEARCH_URL`, `MEILISEARCH_API_KEY`).
- Index `transcript_items`, primary key `id`.
- One document per line: `{"id":"line-<line id>","mission_id","pass_id","kind":"line","met","speaker","text"}`.
- One document per event: `{"id":"event-<event id>","mission_id","pass_id","kind":"event","met","speaker":null,"text":"<title>"}`.
- Searchable attributes are `text` and `speaker`. Filterable attributes are `mission_id`, `pass_id` and `kind`. The sortable attribute is `met`.
- Every search filters by mission. Notes, landmarks, audit entries and reference data are never sent.
- The index and its settings are created idempotently at start, or as soon as search first answers.
- **Confirmed writes.**
  - A write or removal counts only once its engine task reports `succeeded`. The app waits up to 3 seconds for that.
  - If search is unreachable, or the task has not succeeded by then, the documents become pending search writes.
  - A pin answers 201, and a pass becomes `parsed`, only after one of those two outcomes.
- **Catch-up.**
  - Pending writes are retried every `DEPENDENCY_RETRY_SECONDS` seconds (default 5) and before every search. At the default, they are searchable within 15 seconds of search answering.
  - Catch-up never indexes a document whose line or event no longer exists.

**Broker** (RabbitMQ, `AMQP_URL`).
- **Topology.** Declared idempotently and durable, at start and whenever the broker first answers:
  - exchange `perilune.parse`, type `direct`
  - quorum queue `perilune.parse.q`, with arguments `x-queue-type: quorum`, `x-delivery-limit: 3` and `x-dead-letter-exchange: perilune.parse.dlx`, bound to `perilune.parse` with routing key `parse`
  - exchange `perilune.parse.dlx`, type `fanout`
  - quorum queues `perilune.parse.dead` and `perilune.parse.failed`, both bound to `perilune.parse.dlx`. `perilune.parse.dead` keeps dead-lettered jobs for inspection, and the app never consumes it. `perilune.parse.failed` is consumed by the app.
  - exchange `perilune.webhooks`, type `direct`
  - quorum queue `perilune.webhooks.q`, with argument `x-queue-type: quorum`, bound to `perilune.webhooks` with routing key `send`
- **Relay.** It runs on every instance.
  - It publishes `outbox` rows with null `sent_at`, oldest first, whatever their kind.
  - It runs at start, after each stored upload or reported change, and every `DEPENDENCY_RETRY_SECONDS` seconds.
  - Every message is persistent, with `content_type` `application/json` and `message_id` = the outbox row id.
  - `pass.parse` rows: `type` `pass.parse`, exchange `perilune.parse`, routing key `parse`, body `{"pass_id":"<uuid>","sha256":"<hex>"}`.
  - `webhook.send` rows: `type` `webhook.send`, exchange `perilune.webhooks`, routing key `send`, body `{"event_id":"<mission id>:<version>"}`.
  - `sent_at` is set only after a publisher confirm. A row may be published more than once.
  - The only other change to `sent_at` is the reset to null when a consumer finds storage or the webhook service unreachable.
  - Parse jobs and webhook sends reach the broker only through their outbox rows. No request handler publishes directly.
- **Parse consumers.** Every instance runs them.
  - They consume `perilune.parse.q` with prefetch 1 and manual acknowledgement.
  - A job is acknowledged only:
    - after its parse transaction commits, or
    - at once, when its pass is no longer `stored`, or
    - at once, when its object cannot be read because storage is unreachable (the Business rules case)
  - A parser failure rejects the delivery with requeue.
  - A job arriving on `perilune.parse.failed` marks its pass `parser_failed` if the pass is still `stored`, and is then acknowledged.
- **Webhook consumers.** Every instance runs them on `perilune.webhooks.q`, with prefetch 1 and manual acknowledgement.
  - A row with `delivered_at` set is acknowledged without calling the webhook service.
  - Otherwise the consumer sends the message as described under Webhooks. On a 2xx, or a 409 for an existing event id, it sets `delivered_at` and acknowledges.
  - On an unreachable service, a 5xx or no answer within 3 seconds, it acknowledges and clears `sent_at`, so the relay publishes the row again.
- **Queue unreachable.**
  - Uploads answer 202 and passes stay `stored`. Changes still save, with their webhook rows waiting.
  - The status reports `queue` down, and the author console shows the queue banner.
  - When the broker answers again, the backlog is relayed and consumed with no restart.

**Ephemeris service** (WireMock, `WIREMOCK_URL`). The Hollis Selenodesy Ephemeris API is invented, and so is all of its data. The app calls it from the server only, at `$WIREMOCK_URL`, with no credentials.

Request: `GET /v3/vectors?target=<target>&from=<unix_s>&to=<unix_s>&step=60`.
- `from` and `to` are integer Unix seconds of the mission's first and last sample in track order.
- `step` is always `60`.

Response: 200 `application/json`, for example:

```json
{"target":"TESSERA-3","frame":"MCMF","units":{"position":"km","velocity":"km/s","time":"unix_ms"},"vectors":[{"t":1773450000000,"x":1837.4,"y":0.0,"z":0.0,"vx":0.0,"vy":1.38564,"vz":0.8}]}
```

- `t` is Unix milliseconds. Positions are kilometres, and velocities are kilometres per second.
- Any number may arrive in exponent form.
- The app stores each vector in metres, metres per second and `unix_ms`.
- A body that is not this shape, or a `frame` other than `MCMF`, is a failure.

Paging:
- A page holds at most 500 vectors.
- Further pages are named only by an RFC 8288 `Link` header with `rel="next"`. Its absolute URL is requested exactly as given, until no `next` remains.

Caching:
- The first page carries a strong `ETag`.
- A refresh sends `If-None-Match` with the stored ETag, but only when its first-page URL equals the one that produced that ETag.
- A 304 means the stored vectors are unchanged (outcome `unchanged`), and no further page is requested.
- A set always fetches without `If-None-Match`.

Errors:
- `404 {"code":"unknown_target"}`: on a set, the 422 in API; on a refresh, outcome `unavailable`.
- `429` carries `Retry-After` as delta-seconds or an HTTP-date (RFC 9110). The app waits the stated time, then retries the same request once. A second 429, or a stated wait over 30 seconds, is a failure.
- Any other status, a network error, or no answer within 3 seconds is a failure.
- A failure gives outcome `unavailable`.

Concurrency: at most one request to the service is in flight per mission at any moment, across all instances.

Baseline data loaded at start: target `TESSERA-3` answers three vectors on one page with `ETag: "hollis-tessera3-v1"`.

| `t` | `x` | `y` | `z` | `vx` | `vy` | `vz` |
|---|---|---|---|---|---|---|
| 1773450000000 | 1837.4 | 0.0 | 0.0 | 0.0 | 1.38564 | 0.8 |
| 1773453600000 | -1757.4 | 0.0 | 0.0 | 0.0 | -1.47224 | -0.85 |
| 1773457200000 | 1837.4 | 0.0 | 0.0 | 0.0 | 1.38564 | 0.8 |

- A request for `TESSERA-3` sending `If-None-Match: "hollis-tessera3-v1"` is answered 304 with the same ETag.
- Every other target answers `404 {"code":"unknown_target"}`.

**PDF renderer** (Gotenberg, `GOTENBERG_URL`).
- Each dossier is server-built HTML sent to `POST $GOTENBERG_URL/forms/chromium/convert/html`, as multipart with `index.html` plus the bundled font files.
- The HTML refers only to files sent in the same request.
- The output is A4 portrait, and the PDF's `Title` metadata is the mission name.
- Content, in this order:
  1. Heading `<mission name>`.
  2. Line `Mission dossier · Epoch <epoch_gmt>`.
  3. Heading `Perilune`, then the perilune sample's plate lines `MET`, `GMT`, `LAT`, `LON`, `ALT`, `SPD` and, while the mission has a reference, `ΔR`, formatted as on the readout. With no samples, the line `No samples yet` instead.
  4. Heading `Events`, then a table with columns `MET`, `GMT`, `Title`, `Altitude`, `Speed`, plus `Note` in the author dossier only, in MET order. With no events, the line `No events` instead.
  5. Heading `Landmarks`, then one line per landmark, `<landmark name> <latitude>, <longitude>, range <range> at perilune`. With no landmarks, the line `No landmarks` instead.
  6. Heading `Reference`, then `<reference line>`.
  7. On every page, the footer `Generated <now_gmt> · Perilune Ledger`.
- All values use the display formats in the requester's units: saved units for the author, and the share route's units for the reader.
- When the renderer is unreachable or slower than 10 seconds, the route answers 503 renderer.

**Cache** (Valkey, `VALKEY_URL`).
- **Rate limit.**
  - Key `perilune:share-rate:<token>` holds the token's counted requests and expires within 60 seconds of its newest one.
  - The check and the count are one atomic operation: one script or one transaction.
- **Readers.**
  - Each open share stream holds key `perilune:reader:<mission id>:<stream id>`, with a 30-second expiry.
  - The key is renewed at least every 10 seconds while the stream is open, and deleted the moment the stream closes.
  - The reader count is the number of such keys for the mission. The author stream re-reads it at least every 2 seconds.
- **Cache unreachable.**
  - Share routes are served without a limit (fail open).
  - The status reports `cache` down.
  - The author stream sends `{"readers":null}`.

**Billing** (Kill Bill, `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`). The catalogue and its prices are invented.
- **Catalogue.** Named `perilune-archive`, effective `2026-01-01T00:00:00+00:00`, currency USD, one price list `DEFAULT`, one product `archive` in category `BASE`. Each plan has a single evergreen phase with a recurring price:

  | Plan id | Billing period | Recurring price | Quota (bytes) |
  |---|---|---|---|
  | `archive-free` | MONTHLY | 0.00 USD | 268,435,456 (256 MiB) |
  | `archive-1` | MONTHLY | 4.00 USD | 1,073,741,824 (1 GiB) |
  | `archive-10-annual` | ANNUAL | 288.00 USD | 10,737,418,240 (10 GiB) |

  Rules: plan changes take effect IMMEDIATE, and billing alignment is SUBSCRIPTION. The catalogue is uploaded to the tenant at start, or when billing first answers, unless the tenant already holds a catalogue version with this name and effective date. Quotas live in the app; prices live in the catalogue.
- **Account.** One billing account per installation: external key `perilune-author`, name `Perilune Ledger author`, currency USD. It is created at the first paid or free plan change, and an existing account with that key is reused.
- **Plans.** With no subscription, the plan is `archive-free` and nothing is invoiced. A plan change:
  - creates the base subscription on the account (bundle external key `perilune-archive`) when none exists, or changes its plan with policy IMMEDIATE
  - is confirmed when billing shows the subscription on the new plan with a charged-through date. The app waits up to 10 seconds, re-reading billing.
  - stores the new plan only after that confirmation
- Billing computes every invoice, credit and proration. The app never computes an amount billing owns. The balance shown is billing's account balance.
- The app sends no payments and stores no payment method.
- **Billing unreachable.** Plan changes answer 503 billing. `GET /api/plan` answers from the stored plan. Uploads keep the stored quota. The status reports `billing` down, and the Missions page shows the billing banner.

**Webhooks** (Svix, `SVIX_URL`, `SVIX_API_KEY`).
- **Event types.** `pass.parsed`, `pass.rejected`, `pass.deleted`, `event.pinned` and `share.revoked` are created at start, or when the service first answers. One that already exists is kept.
- **Applications.** One application per mission, with `uid` = the mission id and name = the mission name. It is fetched or created before every endpoint or message call.
- **Endpoints.** Each subscriber is one endpoint of its mission's application, at the subscriber URL, filtered to the five event types. The service signs every delivery with its standard webhook headers.
- **Messages.** Each reported change creates exactly one message with:
  - `eventType` from the Business rules table
  - `eventId` `<mission id>:<change_version>`
  - `payload` `{"type":"<event type>","mission_id","version":<n>,"occurred_at":<Unix seconds integer>,"data":{...}}`, where `occurred_at` is the commit time of the change by the server's clock

  `data` by event type:

  | Event type | `data` |
  |---|---|
  | `event.pinned` | `{"event":{"id","pass_id","met","met_label","title"}}` |
  | `pass.parsed` | `{"pass":{"id","filename","size_bytes","sha256","sample_count","transcript_line_count"}}` |
  | `pass.rejected` | `{"pass":{"id","filename","size_bytes","sha256","rejected_line","rejected_reason"}}` |
  | `pass.deleted` | `{"pass_id"}` |
  | `share.revoked` | `{}` |

  No payload carries a note, a token, a landmark or anything not listed.
- Messages are created even for a mission with no subscribers.
- **Webhooks unreachable.** Changes still succeed. Subscriber changes answer 503 webhooks. The status reports `webhooks` down, and the author console shows the webhooks banner. After the service answers again, every waiting message is created within `DEPENDENCY_RETRY_SECONDS` plus 10 seconds, each exactly once, with its original event id.

**Push alerts** (ntfy, `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`).
- Topic `perilune-<mission id>`. Each alert is one JSON publish, `POST $NTFY_URL/` with basic authentication and the body `{"topic","title","message","priority","tags","click"}`, so non-ASCII mission names and filenames arrive intact.
- Alerts by outcome:

  | Outcome | `title` | `message` | `priority` | `tags` |
  |---|---|---|---|---|
  | parsed | `<mission name>: pass parsed` | `<filename>: <samples> samples, <lines> transcript lines.` | 3 | `["white_check_mark"]` |
  | rejected at a line | `<mission name>: pass rejected` | `<filename>: line <line>, <reason text>.` | 4 | `["warning"]` |
  | `parser_failed` | `<mission name>: pass rejected` | `<filename>: <reason text>.` | 5 | `["rotating_light"]` |

  Counts follow the singular rule in Feedback states.
- `click` is `<APP_PUBLIC_URL>/missions/<mission id>?t=<met of the pass's first sample>` for a parsed pass and `<APP_PUBLIC_URL>/missions/<mission id>` for a rejected one. It is omitted when `APP_PUBLIC_URL` is unset.
- An alert is published once, after the transaction that settled the pass commits, by the consumer that committed it. Redeliveries, replays and the seed pass publish nothing.
- **Push unreachable.** Alerts are best effort. A publish that fails or has no answer within 3 seconds is dropped and never retried. The parse outcome is unchanged.

**Every dependency.** No connection or failure is cached. Every request tries the dependency afresh, with a 3-second timeout unless stated otherwise. A service URL that cannot be used at all (a refused connection or an unexpected scheme) counts as that service being unreachable.

**Storage down.**
- Uploads, deletions and capture downloads, on author and share routes, answer the storage 503.
- Parse jobs wait as in Business rules.
- Everything else works: pins, landmarks, references, units, sharing, streams, frames, audit, dossiers, search, plans and subscribers.
- Both consoles show the storage banner.

**Search down.**
- Searches and deletions answer the search 503.
- Uploads parse and pins save, with pending writes.
- Landmark changes, sharing and streams work, and each still raises the version.

**Queue, ephemeris service, renderer, cache, billing, webhooks or push down.** Each affects only what its own paragraph above names.

### Seed data (DP-06, DP-09, DP-10, DP-16, DP-22, DP-23, DP-35, DP-52, DP-53, DP-54, DP-57, DP-62, DP-73, DP-85, DP-94)

Everything seeded is invented: the mission, lander, ground station, speakers, ephemeris target and numbers.

**Seeding.**
- On first start against an empty database, the app creates one mission and one pass. This happens once only, even when several instances start together.
- The pass goes through the normal store, queue and parse path, under request key `seed-tessera3-orbit1`.
- If storage is down at start, the seed is stored within 15 seconds of storage answering. If the queue is down, the seed pass stays `stored` until the queue answers.
- Seeding leaves `change_version` at 0 and sends no webhook or push alert.
- Seeding appends audit entries as the same changes would: `mission.created`, `pass.stored`, `pass.parsed` and `event.pinned`, as `seq` 1 to 4, and the chain verifies.

**Archive plan at start.** No billing account and no subscription exist. The plan is `archive-free` (`Free, 256.0 MiB`), `used_bytes` is the seed capture's size, `next_billing_date` is `null` and `balance_cents` is `0`. No subscribers exist.

**Mission `Tessera-3`.**
- Epoch `2026-03-14T00:00:00Z`, shown as `2026-073/00:00:00`.
- Units `km` and `m_s`.
- No landmarks, no reference target, no share link and no subscribers.

**Pass `tessera3-orbit1.cap`.** It parses to 720 samples and 6 transcript lines. The capture begins with these three lines:

```
# Tessera-3 orbit 1, Kestrel Ground capture (invented demo data)
# frame: Moon-centred Moon-fixed; metres and metres per second
# S,utc,x_m,y_m,z_m,vx_m_s,vy_m_s,vz_m_s
```

Then comes one sample line for each k from 0 to 719:
- UTC = `2026-03-14T01:00:00Z` + 10·k s
- θ = 2πk/720
- r = 1,797,400 + 40,000·cos θ
- x = r·cos θ, y = r·sin θ·cos 30°, z = r·sin θ·sin 30°
- s = 1,650 − 50·cos θ
- vx = −s·sin θ, vy = s·cos θ·cos 30°, vz = s·cos θ·sin 30°

Every number has exactly one decimal, rounded half away from zero, and negative zero is written `0.0`. The first sample line is `S,2026-03-14T01:00:00Z,1837400.0,0.0,0.0,0.0,1385.6,800.0`. The file uses LF line endings and ends with LF.

Each transcript line follows the sample with the same UTC:

| k | Line |
|---|---|
| 0 | `T,2026-03-14T01:00:00Z,KESTREL,Tessera, Kestrel. Acquisition of signal, loud and clear.` |
| 120 | `T,2026-03-14T01:20:00Z,TESSERA,Kestrel, Tessera. Star tracker locked, attitude nominal.` |
| 355 | `T,2026-03-14T01:59:10Z,KESTREL,Coming up on perilune. Altimeter should read two zero kilometres.` |
| 360 | `T,2026-03-14T02:00:00Z,TESSERA,Perilune. Doppler steady, all channels green.` |
| 600 | `T,2026-03-14T02:40:00Z,KESTREL,Two minutes to loss of signal.` |
| 719 | `T,2026-03-14T02:59:50Z,TESSERA,Kestrel, Tessera. See you on the next pass.` |

**Event.** Title `Perilune pass` at MET 7200, with private note `Check against Kestrel log sheet 14 before publishing.`

For example, with the seed data at start:

| Sample | Readout (km, m/s) | nmi, ft/s |
|---|---|---|
| k = 0 | `MET +000:01:00:00`, `GMT 2026-073/01:00:00`, `LAT 0.00° N`, `LON 0.00° E`, `ALT 100.0 km`, `SPD 1600 m/s` | `54.0 nmi`, `5249 ft/s` |
| k = 180 | `MET +000:01:30:00`, `GMT 2026-073/01:30:00`, `LAT 30.00° N`, `LON 90.00° E`, `ALT 60.0 km`, `SPD 1650 m/s` | `32.4 nmi`, `5413 ft/s` |
| k = 360 | `MET +000:02:00:00`, `GMT 2026-073/02:00:00`, `LON 180.00° E`, `ALT 20.0 km`, `SPD 1700 m/s` | `10.8 nmi`, `5577 ft/s` |

- The plate shows no `ΔR` line until a reference is set.
- The header reads `Epoch 2026-073/00:00:00` and `Perilune 20.0 km at +000:02:00:00`, and λ0 is 180.
- The Speakers list reads `KESTREL 3`, then `TESSERA 3`.
- Searching `perilune` announces `3 results for "perilune"`. Searching `log sheet` announces `No results for "log sheet"`.
- The event list in km and m/s holds the record `'+000:02:00:00,7200,Perilune pass,20.0,1700,`.
- Go to GMT `2026-073/02:00:05` places the lens on k = 360 and writes `t=7200`.
- A typed MET of `+000:01:00:05` pins at `+000:01:00:00`. A typed MET of `T-000:00:05:00` is refused with `No sample at or before this time.`
- `frames?from=3600&to=3610&fps=1` answers 11 frames with `met_ms` 3,600,000 to 3,610,000. Frame 0 equals sample k = 0, and frame 10 equals sample k = 1.
- Pressing Play on k = 0 at `60×` and letting 1 second of page time pass shows `MET +000:01:01:00`, the frame equal to sample k = 6.
- A landmark at latitude 0, longitude `90 E` reads `2729.1 km` at k = 0 (`1473.6 nmi`).
- Setting reference target `TESSERA-3`:
  - requests `from=1773450000&to=1773457190&step=60`
  - shows `Reference TESSERA-3: ready, 3 vectors`
  - gives `ΔR 0.0 km` at k = 0, `ΔR 1797.8 km` (`970.8 nmi`) at k = 180, and `ΔR 0.0 km` at k = 360
  - makes the event list record end `,20.0,1700,0.0`
- A refresh right after the set announces `Reference TESSERA-3 unchanged.`
- Choosing `Archive 1 GiB, 4.00 USD/month` announces `Plan changed to Archive 1 GiB.` and the region reads `Plan Archive 1 GiB: 4.00 USD/month` and `Used <used> of 1.0 GiB`.

## Technical requirements

### Deployment (DP-40)

- Node.js 22 with npm. The app is TypeScript.
- `/app/run.json` has string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set. One origin serves the API and both consoles.
- `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` within 30 seconds of `serve` starting.

### Configuration and secrets (DP-45)

Read these from the environment only, at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`
- `AMQP_URL`
- `WIREMOCK_URL` (the ephemeris service base URL)
- `GOTENBERG_URL`
- `VALKEY_URL`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SVIX_URL`, `SVIX_API_KEY`
- `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD`
- `APP_PUBLIC_PORT`
- `APP_PUBLIC_URL` (when unset, share URLs use the request origin)
- `DEPENDENCY_RETRY_SECONDS`

No credential or service URL is hard-coded or has a literal fallback. None is ever sent to the browser or written into a page, bundle or response. The browser never calls a service directly.

### Server boundary (DP-38, DP-39, DP-40, DP-41, DP-92)

- **Origins.** Serve only built assets, bundled fonts and the API, from one origin, with no CORS headers.
- **Never served.** These answer 404:
  - source files
  - `run.json`
  - package manifests
  - environment files
  - source maps holding secrets
  - stored objects by any path other than the download routes
- **Limits.** Body limits are enforced as in API, before anything is stored.
- **Caching.** Every response under `/s/` and `/api/share/` carries `Cache-Control: no-store`.
- **Streams.** Open streams never block other requests, and no open stream holds a database transaction.
- **Aborted work.**
  - When a client closes a page, a stream or a download part-way, its work stops at once.
  - Within 5 seconds, no database session of the app is active or idle in transaction on its behalf, however many such aborts occur.
  - The next request is served.
- **Boot.**
  - Postgres is required.
  - With storage, search, the queue, the cache, the renderer, the ephemeris service, billing, webhooks or push down at start, the app still starts, answers health, serves both consoles, the Missions page and streams, and reports each probed service `down`.
  - Recovery needs no restart.

### Browser support and performance (DP-32, DP-42, DP-53, DP-66, DP-76)

- Current Chromium, Firefox and WebKit.
- Viewports 375x812, 768x1024 and 1280x800, and widths up to 1920.
- Touch on phones and tablets, device pixel ratios from 1 to 3, and forced colours.
- Day-of-year times read and show the same in any browser time zone.
- With the seed data, a console is usable within three seconds: the slider takes focus and the plate is filled.
- A loupe step or a Go to GMT jump updates the plate text within a tenth of a second.
- During playback, the plate shows the frame for the current playback MET on every animation frame, with no frame skipped behind by more than one animation frame.
- A search reply appears within one second of the quarter-second pause.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unicode-3.0 or SIL OFL 1.1.
- IF-04: The app keeps its own state only in the provided Postgres, MinIO, Meilisearch, RabbitMQ and Valkey (billing, webhook and push records live only in Kill Bill, Svix and ntfy), with no SQLite, no other database, cache or broker, and no captures or PDFs kept on the local disk.
- IF-05: The provided service definitions and their development credentials are left unchanged.
- IF-06: Application source, both server and browser, is TypeScript, and plain JavaScript appears only in tool configuration files.
- IF-07: Fonts, scripts and styles are bundled with the app, and no source file references a third-party origin.

## Engineering standards

- Strict, idiomatic TypeScript: the code compiles under strict mode, and no `any` reaches domain values (missions, passes, samples, frames, events, landmarks, references, request keys, share links, subscribers, plans, audit entries, outbox rows).
- Names in the code match this brief's terms: mission, epoch, pass, capture, sample, frame, playback, MET, GMT day of year, perilune, loupe, event, private note, landmark, range, reference, residual, speaker, dossier, audit entry, request key, pending search write, outbox, share link, expiry, change version, reader, Archive plan, quota, subscriber, webhook, push alert.
- Each of these is decided in exactly one place in the source, and routes and consumers never set a pass state directly:
  - each pass state transition
  - the request-key rule shared by uploads and pins
  - the line-format check and the text-field character rule
  - derived values, residuals and landmark range
  - landmark limits, name matching and coordinate ranges
  - the snapping rule
  - the share-link state check
  - the change-version increase, the audit entry and the webhook it reports
  - the storage quota admission
  - CSV cell neutralisation and quoting
  - conditional and range evaluation
  - the share rate-limit window
  - reader presence
- These are each written once and shared by the server, the browser and the dossier, with no second rounding or parsing path (`toFixed`, `Math.round`, `Intl.NumberFormat`, `/ 100` or `* 100` applied to these values elsewhere):
  - unit conversion with half-away rounding
  - money in cents and sizes in binary units
  - day-of-year parsing and formatting
  - MET label parsing and formatting
  - coordinate parsing and formatting
  - cubic Hermite interpolation and the frame grid, used by the frames API and browser playback alike
- RFC 8785 canonicalisation and the hash chain are written once and used by both append and verify, with no second serializer. No plain object is used as a map keyed by user text (speakers, landmark names, subscriber URLs).
- Integrations are each written once:
  - The outbox relay dispatches both kinds from one place, the queue topology and consumer acknowledgement are written together, and the outbox is the only path to the broker.
  - The ephemeris client's paging, `Retry-After` and ETag handling are written once, and each provider client maps transport failures to the brief's 503 codes in one place.
  - Webhook and push payloads are built from the public shapes, never from author records.
  - Mission changes cross instances through Postgres. The rate limit and reader count go through Valkey.
- The orthographic projection and pointer picking are written once, and device-pixel scaling appears only where the backing store is sized. Playback timing reads only the page's monotonic clock.
- There are no single-implementation abstractions, no forwarding wrappers, no dead, commented-out or unreachable code, and no defensive checks for states the state machines rule out.
- Every error response, including unknown routes, 405, 413, 415, unexpected failures and 503 outage answers, is built by one error builder with the API's error shape. The code adds no feature, route, screen or setting beyond this brief.
