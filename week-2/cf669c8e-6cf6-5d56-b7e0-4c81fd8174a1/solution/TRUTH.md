# TRUTH — Ommezwaai Feeler golden

Each value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys, end to end

1. **Prove the fit.** Start: signed out, `/configure`, no donor. Enter `fgh 12 k` with country `NL`, press `Look up plate` → `status "Plate lookup"` reads `Looking up fgh 12 k...` then `Found Kade K50, 2019, snorfiets, blue plate.`; the address holds `plate=FGH-12-K&regCountry=NL`; `status "Figures"` reads `Checking figures...` then `Total €1,495.00 quoted. VAT €259.46. Range 68 km.` (announced; while current the sentence is visually hidden and the price rail shows each figure with its word) Select `Traction pack` (flight 680 ms, panels at 0.25), drive `slider "Insertion travel"` with End; at the stop the server fit check runs and `status "Fit verdict"` shows the sentence with the word `Fits`. Do the same for `Hub motor`. `Start checkout` opens. (brief: Journeys 1; decided: copy for unspecified states)
2. **Share and re-quote.** Every change adds a history entry and updates figures in place; reload or a shared address restores them. (brief: Journeys 2)
3. **Pay in stages.** Signed in, `Start checkout` → Delivery, Schedule, Deposit; `Pay deposit` creates the order once and requests the deposit with one key → `/orders/<id>`, state `deposit pending`, stage `pending`. Kill Bill's notification is re-read; the stage turns `paid`, state `deposit confirmed`, one `VAT receipt: Deposit for order OM-10001` mail. `Pay Instalment 1` repeats it. (brief: Journeys 3)
4. **Refund a line.** The fitter signs in → `/desk`, opens the order from `Payments waiting`, picks `Refund line`, types an amount; `Refund of €12.50 sent. Pending until the provider confirms.` until every draw is believed, then returned or partly returned; one credit note; the balance is re-spread. (brief: Journeys 4)
5. **Give up on the home fit.** `Switch to workshop fitting` makes no Kill Bill transaction; paid VAT is corrected; one VAT correction mail when non-zero. (brief: Journeys 5)
6. **Book a test ride.** Hold, confirm within the server-timed hold, land on `/rides/<id>` with heading `Test ride confirmed` and one mail; an unconfirmed hold expires by itself. (brief: Journeys 6)
7. **Run the desk.** Open slots, mark rides, record inspection after the registry shows the new class and colour. (brief: Journeys 7)
8. **Fall behind or lose a provider.** Failed collections retry 3 and 6 days after due, then `in arrears`; outages show the published banners and recover without reload. (brief: Journeys 8)

## Palette roles (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | #F4EFE4 | brief: Visual design (warm off-white paper) |
| ground-deep | #EAE3D3 | decided: second paper tone |
| ink | #1B1A17 | brief: near-black ink |
| muted | #59554A | decided: AA 6.49:1 on ground |
| accent | #B3321B | brief: single burnt-orange red (primary actions, fouling); the WebGL fouling edge uses exactly this fill |
| on-accent | #FFFFFF | decided: 6.2:1 on accent |
| class 25 | #1F4E9C | brief: blue mark |
| class 45 | #F2C200 | brief: yellow mark |
| rule / rule-soft | #1B1A17 / #B9B19F | decided |

## Type, space, layout

- Big Shoulders Display 800 headings on a 1.25 ratio (h6 16px … h1 48.83px, 3.05× body), with h1 to h5 in use on `/`, `/configure` and `/bikes` so each step is one quarter above the last; IBM Plex Sans 400/600 body 16px/1.55; IBM Plex Mono 400/500 for every numeral and measurement, including digits in running text. (brief: Visual design Type)
- Spacing unit 8px; controls ≥44px; radius 0; 1–2px ink rules; no shadow, gradient or glow. (brief: Finish, Density; decided: unit)
- Breakpoints: <768 one column (plate entry, scene, Clearance, `Parts schedule` button and sheet, price rail) with `Menu` and drawer; 768–1199 plate entry across the top, scene with Clearance left, parts schedule right, price rail full width beneath; ≥1200 three columns. (brief: Configurator layout)

## Motion table

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Buttons, links, segmented radios | hover, press | 160 ms colour/border | cubic-bezier(.2,.8,.2,1) | none |
| Focus ring | focus | 0 ms | none | same |
| Dialog, drawer, sheet | open, close | 320 ms (WAAPI opacity and transform) | cubic-bezier(.2,.8,.2,1) | at once |
| Checkout step | step change | 320 ms opacity | linear | at once |
| Route | navigation | 320 ms transform | cubic-bezier(.2,.8,.2,1) | none |
| Part flight | select pack or hub | 680 ms | ease-out cubic | snap with 120 ms cross-fade |
| Spring back | drag released short of contact, cancelled touch | 500 ms, no overshoot | ease-out | snap |
| Numerals | figure changes | 680 ms count, final value in `data-cents` at once | ease-out cubic | set at once |
| Story | scroll | pure function of progress | none | six stacked stills |

(brief: Motion and effects)

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| Plate lookup | `Looking up <plate>...` | `Found …` and the address | `No scooter found for that plate.`, catalogue message, `Enter a plate like …` |
| Quote | `Checking figures...` shown, word `checking` | `Total … quoted.` | `Figures could not be refreshed. Nothing here is a current quote.`, word `not current` |
| Fit check | `Checking fit...` | the server sentence | status cleared |
| Deposit / stage payment | `Payment sent. Waiting for confirmation.` | `<stage label> paid.` after a believed notification | `<stage label> failed. Nothing was taken.` |
| Refund | `Refund of <amount> sent. Pending until the provider confirms.` | `returned`, `partly returned` | `failed` |
| Plan save | none | `Plan saved.` | stale message; entries kept |
| Hold | `Hold ends in <n min> min.` | ride page | the four published hold messages |

## Breakpoints and media

767/768 and 1199/1200 are the only layout changes. Media: the moped is drawn in code (Three.js and an SVG still from one parts table, licence `original`); fonts are Fontsource woff2 latin subsets under OFL-1.1, listed in `app/assets.json` and `THIRD_PARTY_NOTICES.md`.

## Decided where the brief is silent

Ids are UUIDs; order numbers follow a PostgreSQL sequence from 10001; pack length along its rail 260 mm; a refused Kill Bill purchase answers 402 `payment_refused` and stores nothing; the Kill Bill probe runs every 4.5 seconds in a slot set by the instance's port, because concurrent health calls can corrupt Kill Bill's queue statistics, and a miss plus a recheck 500 ms later mark it down, inside the 10-second banner limit; the registry probe runs every 3 seconds; what each provider address last answered is a PostgreSQL row keyed by the address, because no rule may depend on one process's memory (brief: One shop on one database), so `/api/status` is a data route; provider addresses and credentials have no default and a missing one stops the process at start (brief: Configuration and secrets); every drawn part has its own dimension line with its value on the line, in ruled rows above and below the moped, because the brief says every part in view has a legible dimension line, and those rows are reserved outside the drawing so that no value overlaps another at 375 px; wheels, seat, left panel, frame, tank and engine measure along x, and hub, pack, fork and right panel across y; a short bar with no free spot over its part stands in the nearest free stretch of a row with a leader back to the part; the camera orbits about a point 180 mm ahead of the moped's middle, so a part on its rail always moves when the view turns, and the picture is shifted so the moped starts centred; background workers run every 500 ms; the donor, geometry, pack, hub, fixed-line, road-class, fee, holiday and bike tables are seeded into PostgreSQL once per database and read on every connection (brief: Services, PostgreSQL); `serve` starts node directly, with no npm process per instance; each instance's pool holds at most 10 connections, because 15 instances share one PostgreSQL; the tenant callback list is one comma-joined value merged and re-verified every 10 seconds.
