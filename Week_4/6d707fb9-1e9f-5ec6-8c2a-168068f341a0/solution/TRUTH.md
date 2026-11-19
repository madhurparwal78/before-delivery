# TRUTH — Fio Contado Desk

The brief made concrete. Every value says where it came from: `brief: <section>` (copied) or `decided: <why>`.

## Journeys

1. **First look to a desk.** Start: fresh browser at `/`. The intro plays once (`brief: Motion and effects`), Try one garment answers `1.01 kg CO₂e` after the 300 ms pause, `/method` and `/questions` read at every width, `Start a desk` or `Sign in` lands on `/styles` with focus on the heading. Recorded: an `assessors` row, a `sessions` row.
2. **Setting up a style.** Marta on `/styles` brings in a catalogue through a preview (nothing saved), saves it (twice changes nothing), opens a style, adds lines and a leg, reorders. Recorded: `styles`, `lines`, `legs` rows, `version` raised on each change; shown `247.3 g` for 215 g/m² × 1.15 m² (`brief: Mass and fibres`).
3. **Asking a supplier.** `New request` sends a mail through Mailpit in the chosen language. The contact opens `/a/<token>`, types `4,35` kWh, chooses a file, sends once. Recorded: MinIO `evidence/<desk>/<request>/<id>` byte for byte, then the answer: `energyMjPerKg` `15.66`, a new result from the kept rows with no library call. Open screens announce it within 5 s.
4. **Factory visit with poor signal.** A visit keeps its wall time, Lisbon moves (`Mon 29 Mar 2027, 07:20 Izmir time · 05:20 Lisbon time`). Offline: readings wait in localStorage with a live count; online: sent in order with their own `Request-Key`; the server stamps `takenAt`.
5. **Reading the footprint.** `Work out footprint` reads `/v2/editions` and every page of the newest edition in effect, keeps the rows with the result. Same elements move on a measure change.
6. **Trying a reduction.** Scenarios use only the kept rows; `r = 50` gives `1.90` and `−0.302 kg CO₂e (−14%)`; the address holds the changes; saving over a re-worked baseline answers 412.
7. **Score and passport.** Score shows only after the service answers; `POST /v1/textile/score` once per body. `/p/<gtin>` reads with no sign-in in four languages; a correction makes a new edition and old ones stay.
8. **Dossier, sign-off, closing.** Ready only after Gotenberg answered and MinIO confirmed. Signing by typed name on `/s/<token>`. Closing waits; erased only after MinIO confirmed each deletion.

## Palette (decided: the dealt palette green-mat-chocolate; roles brief: Visual design)

| Role | Hex | Use |
|---|---|---|
| ground | `#e5e1d8` | page, dialogs |
| panel | `#dad5ca` | panels, table bands, outage bands |
| ink | `#2a1d17` | all text on bone and stone |
| secondary | `#6b5b51` | weave fill only; no text, so it can never land on stone |
| accent | `#456f3a` with `#ffffff` | one button per screen, hero stage |

## Type

Sora 300 headlines, 400 and 600 text; Noto Sans Arabic; Noto Sans figures subset (`brief: Type`). Scale ×1.25 from 1rem (`brief: Type`); interface 0.875rem (`decided: "a little smaller than running body text"`). Tabular digits throughout (`brief: Type`).

## Space and layout

| Viewport | Layout | Source |
|---|---|---|
| ≥1100 | side rail 14rem; method five columns | brief: Screens and layout; rail width decided |
| 768–1099 | top bar with Menu; method two columns | brief: Screens and layout |
| <768 | one column; main action in a fixed bottom bar; dialogs full-height sheets; tables scroll in their frames | brief: Screens and layout, SR4, SR6 |
| 320x568, 812x375 | no sideways scroll; dialogs scroll inside themselves | brief: SR15, SR17 |

Breakpoints 768 and 1100: `brief: Screens and layout`.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Intro name / words | first visit to `/` | 640 / 320 each, ends at 1600 | settle | never plays |
| Label strip | loop from 768 px | 64 s | linear | stops |
| Accordion height | question press | 320 | settle | at once |
| Underline, header solid | hover or focus, scroll 24 px | 160 | settle | at once |
| Caret on Explore and questions | opens or closes | 160 | settle | at once |
| Dialog, sheet, menu, popover | open 160/320, close 160 | | settle | at once |
| Rolling numeral | figure change | 320 | settle | at once |
| Stratum width, marker | measure change, answer | 320, 640 | settle | at once |
| Home strata fragment | scroll past a statement | 320 | settle | at once |

Durations `brief: SR7, Motion and effects`; easing `decided: "starts quickly and settles softly"`, `cubic-bezier(0.2, 0.8, 0.2, 1)`.

## States per async action

Every press: `Working…` with aria-disabled (`brief: SR11`), focus kept, then the published announcement. Refusal: Problems summary with links, focus on it, dialog as typed. Outage: published copy in a stone band, the last figures stay. Session end: band with `Sign in again`, draft kept in localStorage (`brief: Session end`). Failed refresh: one line under the heading, nothing else moves (`brief: SR19`).

## Media and licences

No photographs (`brief: Hero`). Weaves, glyphs and fragments are generated in code, licence `original`. Fonts OFL-1.1 under `app/public/fonts`, listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.

## Decided where the brief is silent

- `Hotspot: <stage>` prints beside the footprint total, because band width alone misreads a close hotspot such as Fossil energy (`decided: brief: Signature, "a hotspot is read rather than hunted"`).
- A style with no result prints `Not worked out` in the Climate cell, and the last page prints `No more styles` beside the inactive `Next page` (`decided: brief: every state is stated in words`).
- Sign-up refusal copy `That email already has a desk. Sign in instead.`, password length `A password has at least 10 characters.` (`decided: the brief fixes the rule and the code, not the words`).
- An uploaded evidence file goes to the store when chosen, so a refusal shows where it was chosen; Sent still needs every file and the answers (`decided: brief: Evidence allows either, and an instant refusal serves the phone user`).
- Sign-out keeps the ended cookie in the browser rather than clearing it, so the server can answer `session_ended` (`decided: brief: Sessions`).
