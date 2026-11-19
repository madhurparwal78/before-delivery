# TRUTH — Mothlight

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (start state → actions → visible and provider-recorded end state)

1. **Start collecting** (brief: Journeys 1)
   * Start: signed out, `/`. The landing page shows `heading 1` "Keep what you find. / Leave the rest in the dark.", links `Save a pin`, `Sign in`, `Sign up`.
   * `Sign up` → `/signup` form (`Name`, `Email`, `Handle`, `Password`, `Create account`). Submit → button reads `Creating account` → heading `Check your email`, text `We sent a code to <email>.`. Mailpit holds one message, subject `Your Mothlight code is <6 digits>`, body with the same code.
   * `Code` + `Confirm` (`Confirming`) → session cookie `ml_session` (HttpOnly, SameSite=Lax), goes to `/`.
   * `/boards` → `Create board` → dialog `Create board` (`Name`, radiogroup `Visibility`, `Create`) → Postgres holds the board; dialog closes.
   * `/create`: keyboard only — `Choose image` (Enter opens the chooser), `Title`, `Description` (hashtags), `Alt text`, `Source link`, `Board`, `Publish`. Publish → `Publishing` → `/pin/<id>`, polite `Pin published`. MinIO holds `images/<image id>/original.png` and `w236/w474/w736.png` (those no wider than the image); Postgres holds the pin at position 1.
   * The pin page shows tags as links (`#tag`), the source as its host link, the credit line. Search for a title word finds the pin.
2. **Browse the feed** (brief: Journeys 2) — `/` shows one masonry grid (`feed "Pins"`), arrow keys move focus by placement, Enter opens the pin: `Lamp-carry` (520 ms) carries the image to the exhibit; React (menu `Reactions`) and comment; Escape carries it back, restores scroll to the pixel and focuses the same card. New pins from followed people wait behind `Show <n> new pin(s)`.
3. **Save with credit** (brief: Journeys 3) — `S` on a focused card opens `dialog "Save to board"` (focus on `searchbox "Find a board"`); typing filters, Down moves into `listbox "Boards"`, Enter saves: toast + polite `Saved to <board>`. The save is a new pin owned by the saver sharing the image (no new MinIO object), `saved_from` = root original. The original's open page shows the saves count change via `counts` messages. Deleting the original makes the save's credit `Saved from <name> · Original removed` (no link).
4. **Curate a board** (brief: Journeys 4) — Alt+Up/Down reorders a pin or a section header (polite `Moved <title> to position <k> of <n>`); Space / Shift+arrows / Shift-click select; toolbar `Move`/`Copy`/`Delete`; `Move here` → one `POST /api/operations` → toast `<n> pins moved to <board> · Undo` with `data-deadline`; Undo restores exact prior places; the toast leaves on `operation_expired`.
5. **Work together** (brief: Journeys 5) — Invite dialog → one email per invite (`Role: Editor|Viewer`, link `<APP_PUBLIC_URL>/invites/<token>`), reply identical for known and unknown addresses; the invite page `Join <board>` / `Join board`; the editor's new pin appears live on the owner's board with `<name> added <title>`; downgrade → `membership` message → controls disappear and `You can now only view this board`; removal → `Board not found` without reload.
6. **Keep a secret** (brief: Journeys 6) — one visibility predicate (`server/access.ts`) is used by every query; hidden records answer with the same bytes as a missing id.
7. **On the phone** (brief: Journeys 7) — below 600 px: two columns, bottom tab bar `navigation "Tabs"`, bottom sheets; a 500 ms touch hold (≤10 px movement) on a card opens `Save to board` and does not open the pin; reduced motion makes opening a 120 ms crossfade.
8. **Storage outage** (brief: Journeys 8) — uploads answer `503 storage_unavailable`; the composer shows the bone banner `Images can't be uploaded right now. Your draft is kept.` and keeps every field and the chosen file; health stays 200 with `{"status":"unavailable"}`; saves, comments, reactions, edits and moves still work; `/media` answers 503 and cards show `Image unavailable`.

## Palette roles (design direction dark-room; brief: Visual design "Colour")

| Role | Hex | Source |
|---|---|---|
| ground (near-black green field) | #0b110e | decided: exact value for the brief's "near-black green field" |
| surface (fields, panels) | #121b17 | decided: "slightly lighter green-black" |
| raised (hover) | #18241e | decided: one step above surface |
| ink (warm bone white) | #ebe6d6 | decided: exact value for "warm bone white"; 15.28:1 on ground |
| muted (soft grey-green meta text) | #a3b8ab | decided: kept above 7:1 (9.09 on ground) |
| accent (pale jade, only solid light rectangle) | #9fd9bd | brief: pale jade; text on it is ground |
| danger (error text) | #f0a79a | decided: 9.72:1 on ground |
| bone banner (outage) | #ebe6d6 with ground text | brief: Visual design "Working screens" |

## Type (brief: Visual design "Type")

TikTok Sans (variable wght 300–900, wdth 75–150), shipped as `public/fonts/*.woff2` (OFL-1.1). Body 17 px / 1.55 (brief: 16–18 px, about 1.5). Meta text 16 px (brief: never smaller). Headings: each level 1.25× the one below, starting from body (brief). Hero headline `clamp(28px, 3.1vw, 40px)` regular (brief: 28–40). Closing statement `KEEP THE SOURCE. KEEP THE CREDIT.` weight 900, width 150%, uppercase (brief: only place for the wide extra-bold face).

## Space and layout per viewport

* Page margin 16 px, grid gap 16 px, grid width `innerWidth − 32`, columns 2/3/4/5 at <600/<900/<1200/else, column width `floor((G − 16(n−1))/n)`, card height `round(C·h/w)+64`, wide cards (w/h ≥ 1.5, n ≥ 3) span two columns (brief: Business rules "Masonry"). Implemented once in `shared/masonry.ts`.
* 375: tab bar fixed to the bottom, dialogs are bottom sheets (full width, rising from the bottom edge), two columns (brief: Screens and layout).
* 768 / 1024: top bar with `navigation "Primary"`; dialogs are centred 600 px panels (brief).
* 1280 / 1440: five columns; pin page image takes 60% at ≥900 px (brief: Screens).
* Every control ≥ 44×44 (brief: Density).

## Motion table (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| exhibit image (WAAPI transform grid rect → exhibit rect) | open by click/Enter/tap | 520 ms | cubic-bezier(.2,.7,.2,1) (decided: starts quickly, settles softly) | 120 ms crossfade of the exhibit, no travel |
| other cards' images brightness .78 → .25 | open | 320 ms | same | none (jump) |
| exhibit text opacity | open | 200→520 ms | ease-out | with the crossfade |
| close | Escape/Close/Back | reverse of open, 520 ms | same | 120 ms crossfade |
| cards glide to new places | reflow, live updates, resize | 420 ms | same | jump |
| toasts fade | appear/leave | 420 ms | ease | at once |
| card lift to full brightness | hover/focus | 250 ms | ease-out | brief: unchanged outcome |

## States per async action (brief: Feedback states — strings verbatim)

Create account `Creating account` → `Check your email`; Confirm `Confirming`; Sign in `Signing in`; Publish `Publishing`; Save `Saving`/`Saved to <board>`; Create board `Creating`; Delete board `Deleting` → `Board deleted`; Add section `Creating`; bulk `Moving`/`Copying`/`Deleting`; Undo `Undoing` → `Undone`; Send invite `Sending` → `Invite sent to <email>`; Leave `Leaving`; Edit pin `Saving` → `Pin updated`; Comment `Posting`. Errors render in an `alert`, field errors also under the field. Outage banner is bone with an outline warning icon.

## Breakpoints

600, 900, 1200 (brief: Masonry; Screens and layout).

## Media and licences

No pictures are shipped. The moth, fern and empty-state prints are drawn in code (licence `original`). Icons: lucide-react (ISC), inline SVG. Font: TikTok Sans OFL-1.1, listed in `app/assets.json`. Pin images are generated by the server (solid PNG/JPEG) or uploaded by users. All packages are listed in `app/THIRD_PARTY_NOTICES.md`.
