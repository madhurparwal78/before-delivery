# TRUTH: Semenza Desk golden

The brief made concrete, never reinterpreted. `brief: <section>` is copied from `instruction.md`; `decided: <why>` fills a
silence in the brief's own direction. `DESIGN.md` holds the full tables this file summarises.

## Journeys: the ideal flow

| Journey | Start state | Actions | Visible end state | Provider record | Source |
|---|---|---|---|---|---|
| From stamp to condition | Signed in, `/pieces`, empty search box | `New piece`, stamp `48201768`-form number; `/pieces/<id>/condition`, `Add a pin`, arrows, Enter, `Pin` dialog, `Save pin`; `/pieces/<id>/photographs`, `Add photographs` with many files | Pins in reading order by y then x; each upload row reads `Stored`, F-28 announced | Rows in Postgres; files in MinIO at `photographs/<deskId>/<pieceId>/<sha256>`; piece title in Meilisearch within 5 s | brief: Journeys 1, Services |
| From half a name to a held lot | Library seeded with twelve rows | Type `tabaco` in `Search the desk`, follow the result to `/library?material=VM-2041`, read `Stock`, `Hold a dye lot`, `Hold` | F-33 announced, hold in the piece's `Holds` accordion with its server label | One `POST /v2/holds` with one `Idempotency-Key` in the WireMock journal | brief: Journeys 2, Holds |
| Hide lay | Piece with all five pieces in the tray (seeded ones have Seat at 0, 0) | Lift, move, rotate, Enter; refusals keep the piece lifted; a refused mouse drop glides home | Figure F-52 beside the hide, used by the estimate's default area | Layout version raised in Postgres | brief: Journeys 3, Hide |
| Estimate and client page | Piece with due date and client email | `Edit estimate`, totals change in place, `Save estimate`, `Send client page`; client opens `/c/<token>`, `Your answer`, `Send my answer`, full name, `Approve this cover` | Conservator reads F-46 within 5 s; estimate `signedOff` | Mail M1 in Mailpit, sign-off in Postgres | brief: Journeys 4, Client page |
| Bench and glue | Week grid in Turin time | `Add job`, Alt+arrows or `Move <job> to…`, `Glue laid`, cover job too early refused with F-67 | A week the glue rule allows | Jobs and glue instants in Postgres | brief: Journeys 5, Bench, Glue |
| Collection and dossier | Piece with size and weight, signed-off estimate | `Get a quote`, `Book a collection`, `Make dossier`, strip `Waiting`, `Rendering`, `Stored`, `Sign dossier` | `Booked` once label stored; dossier `signed`, history listed | `POST /v1/quotes`, one `POST /v1/collections`, label at `labels/…`, PDF at `dossiers/…` | brief: Journeys 6, Collections, Dossier |
| Old workbook | `/workbook` | `Choose a file`, preview new, matched, refused rows, `Save`, `Save file`, save again | F-88 with zero new the second time; download of the materials list | File at `workbooks/<deskId>/<sha256>.csv` byte for byte | brief: Journeys 7, Workbook |
| A visitor's enquiry | `/work`, case page | Rail, `/enquire`, `Send enquiry` | F-11 in Announcements | Mail to `agnese@bottega-semenza.example`, Reply-To the visitor | brief: Journeys 8, Enquiries |
| A closed client | Active client | `Close client`, `Bring back` within the wait; after the wait | `active` exactly as it was, or `Erased client` only once both providers confirmed | Rows, objects and search entries gone | brief: Journeys 8, Client state |

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| Ground | `#FFFFFF` | brief: Colour roles |
| Surface | `#F3F4F3` | brief: Colour roles; hex decided: neutral, leaning to the mint |
| Ink | `#25282B` | brief: Colour roles; hex decided: near-black charcoal |
| Muted | `#62686C` | brief: Colour roles; hex decided: darkest grey that still reads grey and passes AA on surface |
| Accent | `#BFECD8` | brief: Colour roles; hex decided: pale, low chroma, one tile and the primary button only |
| Tone | `#E2E4E3` | decided: refused and current fill, always with a border, glyph or underline, because the brief allows no further colour |
| Line | `#83898C` | decided: field borders at 3:1 |

## Type

Jost from the app's own files, with a quarter step per heading from 16 px: 14 (floor), 16, 20, 25, 31.25, 39.06, 48.83, 61.04, 76.29, 95.37 px. brief: Direction, Type rules. Japanese and Arabic use the device's faces with no capitals or tightened spacing. brief: Type rules. Tabular figures throughout. brief: Type rules.

## Space and layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| 1280x800 | Twelve columns, 12 px gutters, 24 px margin, tiles radius 28 px, padding 28 px | brief: Composition; values decided: narrow even gutters, generously rounded |
| 768x1024 | Six columns; main action in the page head; dialogs grow from centre | brief: Screens and layout |
| 375x812 | One column; `Menu` sheet; main action in a bar fixed to the bottom; dialogs rise | brief: Desk shell, Screens and layout |
| 320x568 | As 375; names of 80 characters wrap | brief: SR15 |
| 812x375 | Top bar not sticky; panels scroll inside themselves | brief: SR17; decided: the height a sticky bar would take |

The hide's width is the smaller of its tile and five sixths of (viewport height minus 240 px), 280 px at most under 500 px of height. decided: the whole hide stays in view while a piece is moved (brief: Hide mouse at 1280), and its size never follows the tray, whose slots scale with the hide.

## Motion

All easing `cubic-bezier(0.16, 1, 0.3, 1)`: decided, `starts quickly and settles softly` (brief: Motion). Reduced motion ends every row at once through the same function. brief: Reduced motion.

| Element | Trigger | Duration | Source |
|---|---|---|---|
| Work panel height and fade | open, close | 320 ms | brief: Motion |
| Work preview cross-fade | tile changes preview | 160 ms | brief: Motion |
| Header turning solid | past 24 px | 160 ms | brief: Motion |
| Work items, shared drawing to hero | filter, navigation | 320 ms | brief: Motion |
| Rail marker glide | scrolling changes the current number | 160 ms | brief: Motion |
| Slider keyboard step | key | 160 ms | brief: Motion |
| Swatch drawing cross-fade | choice | 320 ms | brief: Motion |
| Compare tray rising | first swatch added | 320 ms | brief: Motion |
| Compare members closing up | one removed | 160 ms | brief: Motion |
| Bench drop settling | card lands | 160 ms | brief: Motion |
| Bench Escape during a drag | card returns | 320 ms | brief: Motion |
| Dossier step check | step finished on an open screen | 320 ms | brief: Motion |
| Dialogs, sheets | open, close | 320 ms | brief: Motion |
| Hide lift, step | Enter, arrows | 160 ms | brief: Signature |
| Hide tray move, rotation, return, figure roll | lift from tray, R, Escape or refused drop, placed | 320 ms | brief: Signature |

## States per async action

Pending: F-01 on its button with `aria-disabled`, focus kept. brief: SR11. Success: the row's copy in Announcements, staying until the next action. brief: Feedback states. Field error: message beside the field, Problems summary, `aria-invalid`. brief: Forms. Outage: the published 503 copy, nothing half-written. brief: Services. Refresh failure: F-02 in `Refresh state` only. brief: SR20. Ended session: F-03, `Sign in again`, draft kept. brief: Ended session.

## Breakpoints

Under 768 one column and sheets; 768 to 1279 six columns; from 1280 twelve columns. brief: Screens and layout. Under 500 px of height the top bar is not sticky. decided: keeps a focused control clear at 812x375 (brief: SR17).

## Media and licences

| Media | Made by | Licence | Source |
|---|---|---|---|
| Chairs, swatch grains, hide, glyphs | generated by `web/shared/dots.ts` | `original` | brief: Mood, IF-06 |
| Seeded photographs | generated PNGs at seed time | `original` | brief: Seed data |
| Jost | `@fontsource/jost` font files | OFL-1.1 | brief: Type rules |
