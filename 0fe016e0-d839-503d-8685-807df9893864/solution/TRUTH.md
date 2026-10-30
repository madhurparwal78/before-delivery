# Truth notes for Rungmark Rollout Ladder

Ground truth for the golden build in `app/`. Each value is marked `brief: <section>` (from
`instruction.md`, verbatim) or `decided: <why>` (the brief is silent).

## Clock and seed figures

- Instants are whole minutes since 1970-01-01 00:00 UTC on the server clock. brief: Business rules
  (Clock). The seed instants (100000 to 115000) are long past, so every seeded soak is satisfied.
- At seed: totals 3 flags, 5 cohorts, 6 devices, 3 promotions, 2 adverse events, 3 evidence packs;
  the next code is PRM-04. Telemetry rungs read Active, Active, Not promoted ×3; its clinical pilot
  has 1 event on 120 devices = 83 basis points. The adaptive bench fleet is at 500 bp, above its
  maximum of 40, with nothing above it to demote. brief: Seed data.
- The three starting exports are byte for byte as printed. brief: Exports (Starting files).
  Verified by `selftest/` against a fresh seed.

## Ideal flow of every journey (brief: Journeys)

1. **WF-01 ladder climb.** Start: seed, alert flag at rung 0. The jump to the regional cohort →
   409 DP-01 `Refused: rung 3 needs an active promotion at rung 1 first (DP-01).` A pasted
   65+ character reference → 422 `attestation_reference: must be 1 to 64 printable characters`,
   shown under `Not accepted:`. The field keeps the full text. A padded reference at the bench
   fleet → 201, stored trimmed. The clinical pilot at once → 409 DP-02 naming elapsed, minimum and
   remaining minutes. Saving the bench soak to exactly the elapsed minutes, then promoting → 201.
   End: rung 1 `Active Attested`, rung 2 `Soaking Attested`, evidence pack Gap rungs `none`. Trace
   WF-01-1..4.
2. **WF-02 force enable.** Regional → 409 DP-01 naming rung 2. Maximum raised to 1000. Two consoles
   press Force enable at the clinical pilot: one 201 (null reference, next code), one 422
   `cohort_code: rung 2 is already active`. The losing console reloads at once: rung 2 `Gap` and
   Gap rungs `2`. Focus stays on its Force enable button.
3. **WF-03 rollback.** Roll back over a lost answer: the console resends with the same key and the
   server replays the first 200 (`Idempotent-Replayed: true`), so exactly one rung is demoted.
   Restoring with the old reference → 422 `has already been used`. A fresh reference → 201 with the
   next code. The regional cohort at once → 409 DP-02 (the soak restarted). Rung 2 `Soaking
   Attested` at 83 bp (the seeded event from the earlier interval still counts).
4. **WF-04 breach.** Regional soak 0; rungs 3 and 4 promoted. Maximum lowered to 100 (83 bp, nothing
   demoted). A new event on DEV-0101/0102 → 166 bp > 100 → rung 4 demoted at now, rung 3 at now+1.
   The duplicate complaint in lower case → 422 `event_code: has already been recorded`. Raising the
   maximum to 300 restores nothing; only a fresh promotion brings rung 3 back. The card, detail,
   pack, `adverse-rates.txt` and reader totals agree.

## Palette (hex used by the build; brief: Visual design names the roles)

| Role | Hex | Source |
|---|---|---|
| page ground | #F5F6F4 | brief: light neutral grey-white |
| text | #16191D, secondary #4B5563 | brief: near-black; decided: AA secondary |
| Promote fill | #1E3A8A, pressed #142A66, white text | brief: one strong deep blue |
| Force enable | fill #FFF7E8, 2 px edge #B7791F, ink text | brief: muted amber edge on a pale fill |
| Gap chip / alert | #F2B33D chip; alert wash #FFF3DA with #B86A00 edge | brief: warning amber |
| Demoted chip | #D0D4D9 | brief: muted grey |
| Active chip | #A3D3AE | brief: quiet green |
| Soaking chip | #D4E5FB | brief: pale blue |
| Attested label | #1D5E36 text with tick | decided: deep green text beside the word |
| focus ring | 3 px #1D4ED8, offset 2 px | decided |

## Type, space and layout

- Font stack "Segoe UI", "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif.
  Body 15 px, h1 22.5 px/700 (1.5×), h2 17 px/600, card 14 px, helper 13 px;
  `tabular-nums` on every figure. brief: Type; decided: sizes.
- Spacing 4 px steps; radius 6 px controls/cards, 10 px regions. decided.
- Breakpoints (decided, within brief: Layout by viewport): <600 px one column, buttons wrap and
  stretch, tables scroll in their frame; 600–1099 px flag regions stacked one per row, table headings wrap between words so the evidence pack
  fits its frame and the history scrolls inside its own; ≥1100 px three
  flag regions side by side, then form | Settings, then evidence pack and history full width.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| everything | any state change | 0 (none) | — | identical |
| buttons | press | instant background darken (`:active`) | — | identical |

## States per async action (brief: Interactions, Feedback states)

| Action | Pending | Success | Refusal / field error | Outage |
|---|---|---|---|---|
| Promote / Force enable / Roll back | button `Working…`, disabled; cards unchanged; one automatic resend with the same key if no response | `Console status` copy; flag detail, pack, history reloaded and shown in the same moment | region alert with the server's `error` or `Not accepted:` lines; reload at once; reference kept; focus kept | alert `The rollout store did not answer. Check the promotion history before trying again.` |
| Record adverse event | `Working…` | `Recorded adverse event <CODE>.`, code field cleared, every flag reloaded | form alert, code field keeps text | form alert outage copy |
| Save maximum / Save soak | `Working…` | `Saved.`, every flag reloaded | Settings alert | Settings alert outage copy |

## Media

None besides two inline SVG glyphs drawn for this app (ladder mark, tick): licence `original`.
`app/assets.json` is `[]` (no binary assets). decided.

## Disputes

None open. The DP-02 dispute on `test_refusals_change_nothing` (iterations 1 to 5) is closed. The
verifier run it was raised against used an earlier suite that left FLG-ADAPTIVE at the seeded
PRM-03, whose soak was already far above 525600. The current suite starts with `reset(base, flag, 0)`
and a fresh rung 1 promotion, so rung 1 has soaked 0 of 525600 minutes, and brief lines 93 and 375
require the 409 the test expects. The unchanged build answers it: all 39 reference tests pass
against a cold deploy, and gofmt and go vet are clean.
