# TRUTH — Plainwork golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.
The built app passes the reference suite (183 of 183 on a clean instance); this file records the intended behaviour it implements.

## Journeys (start state, actions, visible end state, provider-recorded end state)

1. **Join and confirm** (brief: Journeys 1). Start: signed out on `/`. Press Join, enter Name, Email, Handle, Password, press Create account.
   Provider: Mailpit holds one message to the email, subject `Your Plainwork code: <six digits>`, code also in the body. Sign-in before
   confirming answers 409 `unconfirmed` (alert `Confirm your email first. We sent you a code.`). On `/confirm` type the code, press Confirm:
   session cookie `pw_session` (HttpOnly, SameSite=Lax, Path=/) is set and `/feed` shows `Your feed is empty.` with `Find people`.
2. **Invite and connect** (brief: Journeys 2). Ines opens `/in/priya-dunmore`: numeral `2`, label `2nd`, `1 mutual connection`, path
   `Theo Marchetti`. Connect creates a pending request (Postgres `invitations`), button becomes Withdraw, Mailpit gets
   `Ines Okafor-Vale wants to connect on Plainwork` for Priya. Priya, on My network, sees the invitation without reload (event `network`)
   and accepts: Ines's numeral rolls to `1` (480 ms), mutual line settles, Message and Endorse appear at 600 ms; Ines, on Priya's
   profile, hears `You are now connected with Priya Dunmore. 1st degree.` and Priya, on My network, hears
   `You are now connected with Ines Okafor-Vale.` (brief: Feedback states → Announcements); Mailpit gets `Priya Dunmore accepted your invitation` for Ines.
3. **Withdraw and wait** (brief: Journeys 3). Withdraw then Connect again at once: alert
   `You withdrew an invitation to <name>. You can invite them again on <date> at <time>.` from the server's `retry_at` in the configured
   zone. At the clock's `retry_at` the invitation goes through. The sixth request in 604,800 s is refused with
   `You've reached the weekly invitation limit of 5.`.
4. **Post, react and talk** (brief: Journeys 4). Composer with a picked mention and a hashtag; counts and summaries change live on the
   author's page; deleting the post removes it from every feed, search, hashtag page, notification and plain repost.
5. **Message** (brief: Journeys 5). Typing status `<first name> is typing…`, live delivery, `Seen <time>`, unread counts fall to zero.
6. **Block** (brief: Journeys 6). `More actions` > `Block <name>` > confirm; profiles 404 both ways; the block cascade (connection, pending
   requests, follows) is one transaction; Settings > Unblock returns the pair to none.
7. **Apply and follow the stages** (brief: Journeys 7). PDF resume stored byte for byte at `resumes/<member id>/<resume id>.pdf`;
   applicants board moves Applied > Viewed > Interviewing > Offered; Applied tab updates live; at the closing instant the job page shows
   `No longer accepting applications`.
8. **Edit a job together** (brief: Journeys 8). Presence `<name> is also editing`, field notes `<first name> is typing here`, field conflict
   with `Use theirs` / `Keep mine`, screening questions by keyboard, knock-out rejects at submit with an automatic history entry and email.
9. **Keep a profile on a phone** (brief: Journeys 9). Section version conflict with `Load latest` / `Save mine anyway`; messaging by touch
   from the bottom tab bar.

## Palette (DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground (page, `body`) | `#0A1030` | brief: Visual design (deep night navy); decided: exact hue |
| raised (posts, cards, panels, dialogs) | `#141C45` | brief: Visual design (slightly lighter navy) |
| ink and accent (text, links, pink buttons, focus ring) | `#FFC4DC` | brief: Visual design (same soft pink) |
| muted (secondary text, `work`) | `#D79BB6` | brief: Visual design (muted dusty rose) |
| pressed (pink button while pressed) | `#E5A3C1` | brief: Motion (darkens slightly while pressed) |
| danger (alert text, still pink family) | `#FF9DB0` | decided: one hue on the field |

Contrast: ink on ground 12.55, on raised 11.06; muted on ground 8.19, on raised 7.22; navy on pink 12.55 (all AA).

## Type, space and layout

- Funnel Display (statements, names, numerals, headings) and Funnel Sans (everything else): variable woff2, latin and latin-ext, in
  `web/public/fonts`; OFL-1.1 (brief: Visual design). Sizes 16, 24, 36, 54 px (x1.5 each; decided), statement lines 11vw (brief: 9 to 14
  percent), degree numeral 18vw (brief: about 18 percent). Tabular figures on counts, times and degrees.
- Square corners everywhere, no rules, no shadows, no icons; entries are raised fields at least 24 px apart (brief: Visual design).
- Phone below 768: bottom tab bar, header monogram + search + Notifications + Me, single column, full-screen dialogs and composer,
  messaging one screen at a time, board in one column, targets at least 44 px. Tablet 768 to 1199: header navigation, single column feed,
  board in two rows of three. Desktop 1200 and up: feed two thirds + `Your network` panel, profile two columns, messaging list about one third,
  board in one row of six (brief: Screens and layout).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Dialogs, menus | open and close | 180 ms opacity | fast start, gentle settle | no fade |
| Entries inserted from the pill | Show new posts | 320 ms opacity and transform | same | appear without movement |
| Degree Roll numeral (WAAPI) | degree change | 480 ms | start fast, settle | end state in the first frame |
| Mutual line reflow | 280 to 600 ms after the change | 320 ms | same | instant swap |
| Message / Endorse | 600 ms after the change | 180 ms opacity | same | appear at once |
| Link underline, pink button press | hover, press | 120 ms, 80 ms | same | none |

No looping, pulsing or shimmering motion anywhere (brief: Motion and effects).

## States per async action

Pending: button disabled, same text; uploads `Uploading…`; message sending `Sending…`. Success: polite status region text from the brief's
Announcements table. Failure: `alert` beside the control with the brief's text; field validation under the field with a linked summary.
Empty, unavailable and not-found states are one big sentence plus one underlined action, strings verbatim from the brief. Storage down:
uploads refused with 503 and `Uploads are unavailable right now. Try again later.`; health `{"status":"unavailable"}` with 200.

## Services

PostgreSQL (`DATABASE_URL`): every record and the business clock offset; schema applied at every start. MinIO: `photos/<photo id>.jpg|png`
(APP1 to APP15 and comment segments, or tEXt/zTXt/iTXt/eXIf/tIME chunks, removed), `resumes/<member id>/<resume id>.pdf`. Mailpit: the five
published subjects; delivery is queued in Postgres and retried every 10 s for 10 minutes. No other datastore.

## Media and licences

No pictures, icons or illustrations (brief: Visual design). Fonts: Funnel Display and Funnel Sans, OFL-1.1, Copyright 2023 The Funnel
Project Authors, files listed in `app/assets.json`. Packages: MIT, ISC, BSD, Apache-2.0, 0BSD (listed in `app/THIRD_PARTY_NOTICES.md`).
