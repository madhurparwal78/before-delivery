# TRUTH — what the Fernsquare golden does

Every value says where it comes from: `brief: <section>` (verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Ideal end-to-end flows

Seed start state (brief: Seed data): clock at block 5, `10:01:15` Berlin. Fernhill Labs: Amara owner (2,000.000000 FERN, available 1,999.986487), Felix developer
(5,000.000000), Priya viewer (100.000000); namespaces Orchard `00000000000000a100`, Harbor `00000000000000b200`, Lantern `00000000000000c300`; blocks 1-5
(Available, Available, Available, Rejected withheld, Rejected bad-encoded with a fraud proof on row 0); mempool of two pending blobs by Amara; light nodes Wren
(auto-sample on) and Kestrel; validators Alder, Birch, Cedar, Dogwood; proposals 1-7. Quarry Labs: Jonas, namespace Quarry main, light node Heron, same validators.

1. **Submit a blob and watch it land** (brief: Journeys 1). Felix on Submit picks Harbor, types data: Size, Shares, Gas, Fee readouts follow every keystroke, Fee
   prefilled with the minimum; Enter submits: 201, MinIO holds `blobs/<blobId>` byte for byte, the Your blobs table says `Pending`, `Available` drops by the held fee,
   Amara's `Mempool` count goes up by one without a reload. At the next block (`Block 6 produced: 3 blobs, square 4 × 4.` in Network updates) both pages show
   `Included in block 6`; Felix's shares sit at (1, 2), (1, 3), (2, 0), (2, 1); the fee is charged (ledger `Fee`, counter account `burn`).
2. **Inspect a block share by share** (Journeys 2). Block 2: arrow keys walk the grid (Home, End, Ctrl+Home, Ctrl+End); Enter opens `Share r, c` with Namespace, Info byte,
   Sequence length (first shares), Data; Escape returns focus to the cell. Row roots beside the square, Column roots below, `Data root <hex>` equal to the Commit card.
   Prove namespace Harbor: Row 0 inclusion (3 proof nodes), Row 1 inclusion, rows 2-3 outside; absence of `00000000000000b100`; Verify row recomputes the root in the browser.
3. **Sample a block** (Journeys 3). Kestrel, block 2, Take sample three times: `Sample 1: share (6, 2) available. Confidence 39.0625%.` and so on; Auto-sample on: Kestrel
   samples each new block once per `SAMPLE_INTERVAL_MS`.
4. **Stage an attack** (Journeys 4). Amara sets Next block to Withhold shares; block 6 shows Sampling; Wren's sixth sample (3, 4) is withheld: every open page shows
   `Block 6 was rejected: shares were withheld. Light node Wren could not fetch share (3, 4).`, blob transactions turn `Rejected — block 6 was rejected` with fees refunded,
   one mail per member. Bad encoding: five seconds after production the fraud proof panel shows both roots and `Row 0 is not encoded correctly. Block 6 rejected.`
5. **Delegate, earn, unbond** (Journeys 5). Felix delegates 1,000 FERN to Cedar; block 6 moves his balance to 3,999.992000 FERN and Cedar's stake to 3,000 FERN; rewards grow
   0.084745 FERN per block; undelegating at block 12 withdraws 0.508470 FERN; the unbonding completes at `10:05:00` inclusive: balance 5,000.492470 FERN, ledger
   `Unbonding released from Cedar`, mail `Unbonding complete: 1,000.000000 FERN from Cedar`.
6. **Vote and deposit** (Journeys 6). Felix casts No with veto on proposal 3; after the next block both see `No with veto 3,300.000000 FERN (33.67%)` and
   `Projected result Rejected with veto`; at `10:06:15` the proposal shows `Rejected with veto`. Felix tops up proposal 4 to 100 FERN: voting opens at the block's time and every
   member gets `Voting is open on proposal 4: Add a namespace directory`.
7. **Bring a teammate in** (Journeys 7). Amara invites an email as Developer; one Mailpit message holds `/invites/<token>`; the invitee sets name and password and lands on
   `/w/<id>/explorer`; the link is single-use and refused at and after `INVITE_TTL_HOURS`.
8. **Check a blob on a phone** (Journeys 8). At 390 px the Workspace panels tabs reach block 2; the Harbor blob page stacks facts above the square; tapping a cell opens its panel;
   with reduced motion a new square is fully revealed at once.

## Palette roles (decided values copied from DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground | `#040207` | brief: Colour roles (near-black, faint violet tint) |
| hairline | `#2A2A3A` | brief: Density and shape (dark slate hairline) |
| ink | `#FDFCFF` | brief: Colour roles (near-white, faint violet cast) |
| muted | `#B0B7C0` | brief: Colour roles (cool muted grey) |
| ink on light | `#1A1A1A` | brief: Colour roles (near-black ink on the off-white band) |
| active field | `#C9C9CC` | brief: Colour roles (cool mid-grey, active card, banners) |
| strand violet / lavender / cool | `#8B7CF6` / `#C9C2FF` / `#7A8AA0` | brief: violet and lavender only as strand light; decided: cool grey-teal for parity strands |
| danger text | `#FFB4A8` | decided: brief names no error colour |

## Type, space, layout

Display and body: the system grotesk stack (`system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`), headings semi-bold (600) with `0.04em`
letter spacing, tabular figures; monospace (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`) only for hex, share bytes, hashes and roots (brief: Typefaces).
Scale in px, each step about a fifth larger: 14, 16, 19, 23, 28, 33, 40, 48, 58 (brief: Scale). Form headings 44 at every width (brief: Screens and layout, Submit "a 44 px heading"; Scale "about two and
a half times body size"). Hero 58 at 1280, 52 at 768, 48 on phones, so it is larger than the 44 px form headings and every other type on any screen at every width; the headline reads "Run your own network / where data stays available." (decided: no word longer than `available.`, so 48 px fits the 331 px phone column in Linux Chromium's fallback face) (brief: Scale "The hero headline is the largest type on any screen"); body 16; lede 18
(brief: Explorer "an 18 px lede"). Spacing unit 4 px;
section rhythm 96 px (64 on phones) (decided: tall rhythm of the brief). Container max 1200 px; top bar fixed 64 px; card grids 3 / 2 at 768 / 1 column 342 px (brief: Screens and layout).
Radius: panels 8 px, pills fully round; nothing else (brief: Density and shape).

## Motion

| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| Square walk cards | list top reaches 80% of viewport height or on load | rise 600 ms, card 2 +100 ms, card 3 +200 ms, `cubic-bezier(0.22,1,0.36,1)`; `data-state` hidden / rising / shown by page timers | all `shown` at load, card 1 active | brief: Motion |
| Walk activation | scroll thirds (desktop), centre crossing (phones), hover, focus | fill 350 ms in, inactive dim 150 ms | switches instantly | brief: Motion |
| Stage drawings | card first active | about 1000 ms, once | drawn at once | brief: Stage drawings |
| Square reveal | new block arrives live | row r at r x `SQUARE_ROW_REVEAL_MS` | every row at once | brief: Square reveal |
| Entrances | first sight | 600 ms, siblings +100 ms; letters 30 ms apart | final state | brief: Entrances |
| Hover | pointer | 150 ms; showcase art 600 ms scale 1.04 | removed | brief: Hover and press |
| Marquee | on screen and not hovered | one monogram per 2 s, linear | `data-motion="off"` | brief: Marquee |

## States per async action

Pending: button disabled, `aria-busy="true"`, form status `Working…`. Success: the brief's status copy (Namespace registered, Blob submitted, Transaction sent,
Invite queued, Next block, Snapshot ready). Error: field error under the field linked as its description, the same text in the form alert, focus on the first invalid
field. Outage: `Storage is unavailable, ...` banner and form alert; unreachable server copy for network failures. Denied: control visible and disabled with the role copy
as accessible description; server 403 with the same copy. Loading: faint strand canvas on an `aria-busy` panel (brief: Feedback states, Working screens).

## Breakpoints

375 / 390 phones: top bar = logo, `Submit blob` pill, `Menu`; Workspace panels tablist under the bar; the square scrolls sideways in its own frame (cells at least 44 px);
768: navigation in the bar, two-column cards; 1280: three-column cards, roots list beside the square (brief: Screens and layout, Phones).

## Media and licences

No binary assets, fonts or remote files: strand art is drawn on canvas from stored shares, the spotlight ring and icons are inline SVG written for this app (licence `original`).
Packages: see THIRD_PARTY_NOTICES.md (MIT only).
