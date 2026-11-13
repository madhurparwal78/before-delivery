# TRUTH — Airfold (Halfpenny Post Co.)

The golden's ground truth: the brief made concrete, never reinterpreted. Each value says where it comes from:
`brief: <section>` (copied from the brief) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys, end to end

### 1.1 Sign up on a phone (DP-03, DP-02)
- Start: signed-out visitor on `/` at 375 × 812 (brief: Journeys 1). They activate the link `Choose a username` (brief: Public screens) → `/signup`.
- Step 1: textbox `Username`; `status` `Username availability` (the chip, in the Tab order after the field) shows `Available`, `Taken`, `Use 3 to 32 characters.`, `Use only lowercase letters, numbers, underscores and dots.`, `Start with a letter.` or `Don't end with a dot.` (brief: Feedback states). The syntax reasons show at once; the exchange is asked once, 300 ms (`AVAILABILITY_DEBOUNCE_MS`) after the last keystroke (brief: Configuration). `Continue` (or Enter in the field) makes the identity key pair and the recovery code in the browser (brief: Business rules, Sign-up). Nothing is sent yet. decided: the account is created after the recovery check so an abandoned sign-up never claims a name.
- Step 2: group `Your recovery code` holds `data-testid="recovery-code"` with the code as 8 groups of 4 Crockford characters joined by `-` (brief: Business rules, Recovery code). Button `I've written it down`. Focus moves to the group.
- Step 3: three textboxes `Group <n>` (three distinct positions 1–8, ascending), button `Check`; a wrong group shows the slip `That group doesn't match your recovery code.` and focus moves to the first wrong group. With `GRADING=1`, `?skip_recovery_check=1` skips this step (brief: Configuration).
- Account creation: `POST /api/accounts` with the username, the raw public key, the recovery verifier and the sealed key backup; the server stores only the salted SHA-256 of the verifier, sets `airfold_session` (brief: Business rules, API). The private key is kept only as a non-extractable key in IndexedDB.
- Step 4: textbox `Display name`, button `Add a photo` (file input labelled `Photo`), button `Finish`. Empty name → slip `Enter a display name.`. The profile is sealed with a random 32-byte profile key; a photo is re-encoded, sealed and stored as a `photo` blob first (brief: Business rules, Profile). If the photo cannot be stored, the slip `Your photo couldn't be saved. You can add it in Settings later.` shows and `Finish` continues without it.
- End: `/letters` (Chats) with `No letters yet. Find someone by their exact username.`; document title `Airfold`; tab bar at the bottom.

### 1.2 Find someone and write the first letter (DP-04, DP-05, DP-12)
- Contacts: textbox `Find by username`, Enter runs the lookup (`GET /api/lookup?username=`); `status` `Lookup status` announces `Found <username>.` or `No one with that username.`; focus lands on region `Lookup result`, which shows the username and a plain avatar with `Write a letter`, or the not-found copy (brief: Interactions, Feedback states).
- `Write a letter` → `POST /api/conversations` → `/letters/:id`, focus in the composer.
- Enter in textbox `Write a letter` sends; the letter is sealed in the browser, joins the outbox as `Sending`, the composer empties and keeps focus; on `201` it becomes `Sent` with the server's held time (brief: Interactions, Motion). The recipient's browser shows a row under Letter requests.

### 1.3 Accept a request (DP-06, DP-07)
- Chats shows `Letter requests (1)`; the open request region `Letter request` shows the letters, with `Accept`, `Delete`, `Block` in place of the composer. Opening it records a read but no receipt; the sender's postmark stays `Delivered` (brief: Business rules, Conversations and requests).
- `Accept` → the conversation is accepted; the recipient's browser posts a profile control letter; when the starter's browser receives it and has not yet sent its own profile key it replies with one, so each side opens the other's profile and the sender sees the display name and photo without reloading.
- decided: a reload between accepting and posting never loses the key (the debt is stored first and re-queued at the next start).

### 1.4 Write while the connection drops (DP-13, DP-14)
- Offline: after `CONNECTING_DELAY_MS` (2000 ms) the `Connection` status shows `Connecting...`; five letters stay `Sending` in IndexedDB; online (or socket reconnect) retries at once; they post one at a time in the order written; backoff 1 s, 2 s, 4 s, 8 s, 16 s, 32 s, then 60 s (brief: Business rules, Outbox). Replays use the same letter id and the same sealed body, so none is stored twice.

### 1.5 Collect what was held (DP-15, DP-16, DP-17)
- On load and on every reconnect the browser fetches `GET /api/inbox`, opens each held letter in order and acknowledges through the highest seq; the `Connection` status shows `Updating... <n> letters` (`Updating... 1 letter` for one) for at least one second; badges (row, Chats tab, document title `(<n>) Airfold`) equal the server's unread count.

### 1.6 Photo or file (DP-18 to DP-25)
- Photo: JPEG, PNG or WebP only (`Choose a JPEG, PNG or WebP photo.` otherwise); re-encoded as JPEG without metadata, long edge ≤ 2048, never enlarged, a sealed ≤ 32 px thumb inside the letter. A file over the cap (sealed size = size + 16) is refused before any request with `This file is larger than <limit> and can't be sent.` (brief: Feedback states).
- The letter reads `Sending` with an uploading line until `POST /api/blobs`, `PUT /api/blobs/:id/content` (exactly the sealed bytes) and then `POST /api/letters` succeed; `Upload finished.` is announced; a failed upload shows `Couldn't upload. Your letter wasn't sent.` and `Retry upload` (same letter id).
- Recipient: blurred preview (`data-testid="photo-preview"`), then the photo (alt `Photo from <name>` / `Your photo`) inside `Open photo`; the `Photo viewer` dialog closes with Escape back to the photo. The downloaded bytes are checked against the sealed digest; a mismatch shows `Attachment corrupted` with no download.
- Storage outage: banner `Photos and files can't be sent or opened right now. Letters still go through.` in an `alert`; text letters keep flowing.

### 1.7 Restore on a new browser and re-check the seal (DP-30 to DP-33)
- `/signin`: `Username`, `Recovery code` (any case, hyphens or spaces), `Restore account`. `POST /api/recover` makes the new key current, records the old key, revokes every other session (their sockets get `signed_out` and the browser shows `Signed out` with `This account was restored in another browser, so this browser is signed out.`). Failure: `That username and recovery code don't match.`; after 5 failures in 60 s: `Too many tries. Wait a minute and try again.`
- The restored browser opens every earlier key backup (so held letters still open), seals a fresh profile and sends the new profile key to every accepted contact. decided: the old profile key lived only in the old browser, so the new profile's display name is the account's username and has no photo until changed in Settings.
- The contact sees region `Seal number changed` with `Compare seal numbers` and `Accept new seal number`; letters stay `Sending` (resealed to the new key, same ids) until `Accept new seal number`; then focus goes to the composer and the profile key is sent again.
- Seal number: SHA-512 of the two raw public keys sorted bytewise, twelve groups of five digits, shown in `data-testid="seal-number"`.

### 1.8 Tidy up (DP-26 to DP-29, DP-34 to DP-37)
- Letter actions (button or a half-second press): `Delete for me` hides the letter and shows the snackbar `Letter deleted.` with `Undo` for `UNDO_MS` (5000 ms); after the window the letter is removed from this browser's store; `Delete for everyone` (own letters, `can_retract` true from a refetch) replaces it for both people with `You deleted this letter.` / `This letter was deleted.`
- Block: dialog `Block <name>?` with `<name> won't be able to reach you. Letters they send while blocked are never delivered.`; the conversation shows `You blocked <name>.` and `Unblock`; Settings lists `Blocked contacts`.
- Mute: dialog `Mute letters` with radios `1 hour`, `8 hours`, `1 week`, `Always` and `Mute`; a muted row reads `Muted` and raises no toast; badges still count.
- Username: `New username` with the chip; cooldown `You can change your username again on <date>.`; success announces `Your username is now <username>.`

## 2. Palette roles (DP-44; brief: Visual design)

| Role | Hex | Source |
|---|---|---|
| ground | #F26A1B | brief: Visual design (hot, saturated; judged hue 15–40°, saturation ≥ 80%) |
| surface | #F98B4A | brief: Visual design (slightly lighter orange; judged lighter, hue within 10°) |
| ink / accent | #0A1430 | brief: Visual design (near-black blue-black) |
| muted | #4A1C08 | brief: Visual design (deep burnt brown) |
| white | #FFFFFF | brief: Visual design (letters, hero sheet, banners, key-change stub) |

All pairs ≥ 4.5:1: ink/white 18.17, ink/ground 5.93, ink/surface 7.63, muted/surface 6.04, muted/white 14.38, muted/ground 4.69, ground/ink 5.93 (decided: computed from the hex values).

## 3. Type (brief: Visual design)

Zilla Slab only, self-hosted (Latin and Latin Extended woff2): display and headings 600, names in rows 500, body 400; each heading step is 1.25 × the one below (1 → 1.25 → 1.5625 → 1.953 rem); sentence case, no capitals as labels. Hero heading ≈ 4.7–5 × body on a desktop window, centred on two staggered lines.

## 4. Space and layout per viewport (DP-40; brief: Screens and layout)

| Width | Layout |
|---|---|
| < 768 (check 375 × 812) | one pane at a time; bottom tab bar `Chats`, `Contacts`, `Settings`; conversation replaces the list with `Back to letters`; `Contact card` opens a dialog |
| 768–1199 (check 768 × 1024) | list column ≈ 40% beside the open conversation; tab bar across the top of the list column; contact card is a dialog |
| ≥ 1200 (check 1280 × 800) | list, conversation, and a standing `Contact card` region; the `Contact card` button is hidden |

No horizontal scrolling and every control inside the window at every width; every button, link and textbox ≥ 44 × 44 px (brief: Interactions; DP-43). Spacing unit 8 px (decided: comfortable density).

Hero (brief: Visual design): white 5:7 sheet covering the middle half of the width (640 px at 1280), starting a fifth of the window height down (160 px at 800), scalloped inner corners, airmail stripe edge, one dotted fold line, postmark ring top right with `Halfpenny Post · held until you're back`; `Hp` monogram top left, three links centred, solid ink `Choose a username` top right. Phone: sheet full width less a 12 px margin, starting below a 72 px top bar.

## 5. Motion (DP-42, DP-43; brief: Motion and effects)

| Element | Trigger | Timing | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| lower third folds up | Send | 0 → 320 ms, `rotateX` half turn | fast out, soft in, no bounce | no overlay; the letter fades in over 100 ms |
| top third folds down | Send | 120 → 440 ms | same | same |
| gummed flap closes | Send | 440 → 640 ms | same | same |
| folded letter shrinks into its row (≥ 768: the same row slides to the top) or the sheet foot (< 768) | Send | 640 → 1040 ms; whole sequence ends ≈ 1.04 s | same | same |
| postmark strike | server accepts | 200 ms, scale 1.15 → 1, rotate 0 → −8° | same | `Sent` appears in place |
| re-strike on Delivered / Read / returned | state change on either screen | 200 ms; digits change left to right, 60 ms stagger, ≤ 400 ms | same | instant text change plus a 3 px ink underline for 2 s |
| unfold of the newest unopened letter | conversation opened in the app | ≤ 380 ms, folds in reverse | same | skipped |
| dialogs and toasts | open / close | 180 ms fade and rise | ease-out | 100 ms fade |
| loading stripe | list or sheet loading | one bar per 300 ms, stops at once | steps | stands still |
| after reload | — | none | — | none |

Nothing loops. All imagery is drawn in code.

## 6. States per async action (brief: Feedback states)

| Action | Pending | Success | Failure |
|---|---|---|---|
| any started request | its button is disabled and `aria-busy`, name unchanged | visible change | slip `Something went wrong. Try again.` |
| availability check | chip empty until the debounce ends | `Available` | reason copy |
| send a letter | `Sending` postmark, no time | `Sent. Held for <name> until they collect it.` | retried with backoff; other 4xx: `This letter couldn't be sent.` |
| delivered / read / returned | — | `Delivered to <name> at <time>.` / `Read by <name> at <time>.` / `Your letter to <name> was returned: not collected in 30 days.` | — |
| new letter in the open conversation | — | `New letter from <name>.` | — |
| lookup | — | `Found <username>.` | `No one with that username.` |
| photo or file upload | uploading line | `Upload finished.` | `Couldn't upload. Your letter wasn't sent.` |
| open an attachment | — | the picture or the download | `This attachment can't be opened right now.` / `Attachment corrupted` |
| open a conversation that is not yours or does not exist | — | — | `We couldn't find that letter.` inside an empty sheet |
| toast | polite, never takes focus, `TOAST_MS` (4000 ms) | `<name>: <first line>`, `<name>` or `New letter` by the preview setting | — |

Empty states: `No letters yet. Find someone by their exact username.`, `No letter requests.`, `No contacts yet.`, `You haven't blocked anyone.`, `Nothing written yet. Your first letter is sealed before it leaves this page.`

## 7. Server truths (brief: API, Business rules, Services)

- Statuses and bodies are exactly the brief's table; the error order is boundary (413, 415, 403), 401, 404, 403, replay, 409, 413/422, 503.
- Letters are held in PostgreSQL as ciphertext only until acknowledged; delivery, read, return and retract rules are decided in one place each (`delivery.ts`). decided: `seq` is allocated under a global advisory lock so an acknowledgement through the highest seq never skips a letter.
- A letter posted to someone who blocked the sender is answered `201 sent`, stored without ciphertext and never queued or announced to the recipient (brief: Business rules, Blocking).
- Time: every timestamp and rule reads the server clock plus the grading offset (brief: Time rules).
- decided: the exchange's S3 client signs with AWS Signature V4 using `node:crypto` (no SDK), so no cryptography package ships (IF-06).

## 8. Media and licences

- Zilla Slab 400, 500, 600, Latin and Latin Extended woff2: SIL OFL 1.1 (brief: Visual design; IF-03), listed in `app/assets.json` with sha256 and source, full licence text in `THIRD_PARTY_NOTICES.md`.
- Avatar, monogram, postmark ring, airmail stripe, glyphs: drawn in code (licence `original`; brief: Images).
- No raster, audio, video or model files; no remote request of any kind (IF-05).
