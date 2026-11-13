# TRUTH — Rampwright golden

Every value says where it came from: `brief: <section>` (verbatim from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent). `DESIGN.md` holds the full token tables; this file is the ground truth of behaviour.

## 1. Journeys (start state → actions → visible and provider-recorded end state)

| # | Journey | Ground truth |
|---|---|---|
| 1 | Set up a bench | Signed out on `/` → link "Start a bench" → `/sign-up` → Create account → address `/workspaces/new` (brief: Landing routes). Create workspace → `/w/<new id>`, project list shows `No projects yet. Create one to start a bench.`; New project → `/w/<wid>/p/<pid>`; New scene (Ramp) → `/w/<wid>/s/<sid>`; outline lists `Ramp 1`, stage draws the ramp, inspector shows Position X/Y/Z, Mass, Angle, Length, Friction. Postgres: user, session, workspace, owner membership, project, scene revision 1, three activity rows (`workspace.created`, `project.created`, `scene.created`). |
| 2 | What-if | Seeded `Slope trial` → focus outline row `Ramp A` by keyboard (Enter selects, takes the lease: Valkey `rw:lock:<sid>:ramp-1`) → type `2.5 kg` into Mass (kg): readouts `Potential energy: 49.05 J` update per keystroke; on blur the field reads `2.5`; Save status `Saving...` → `All changes saved`; Postgres: scene revision 2 with `params.mass_kg = 2.5`, one `scene.edited` event. `R`: panels and camera widget vanish, `RUNNING` pill and centre mark appear, cart runs at 1/120 s steps. Pause, N steps, hash read; `R` again: panels back where they were, `step 0`, hash equals the pre-run hash; no revision written. |
| 3 | Co-tutor | Invite as Editor from Settings → Mailpit message `<inviter> invited you to <workspace> on Rampwright`; Notices `Invite sent to <email>`. Re-invite: older invite `revoked/superseded`, `410 invite_superseded` on its link, one pending invite per address. Newest link → sign-up with the invited address → Accept invite → `/w/<wid>` as editor. Both open Slope trial: People here and `Cursor: <name>` overlays. Held `Ramp A` shows `Lock notice` and read-only values; release announces `<object name> is free to edit` and the editor takes the lease. Simultaneous gravity change: loser gets `alertdialog "Scene changed elsewhere"`. Owner makes co-tutor Viewer: open editor turns `View only` within 5 s, leases released and announced, `403 forbidden` on further writes, role-change mail sent. |
| 4 | Import a model | Assets → Model units `cm` → Upload GLB → bytes stored at `assets/<pid>/<sha256>` in MinIO, row counted after storage confirms; Models folder lists the file with `<extent> m` (two decimals, via node transforms); dragging the Props Models tile places it at its converted scale. |
| 5 | Checkpoint and publish | Checkpoints tab → New checkpoint `Before class` → `Checkpoint Before class saved`; MinIO `checkpoints/<sid>/<cid>.json`; scene `draft → checkpointed`. Publish lab: tick `Ramp A: Mass (kg)` and `Ramp A: Angle (degrees)` → Notices `Lab published at <APP_PUBLIC_URL>/lab/<token>`; MinIO `labs/<sid>/<bundleHash>.json`; Mailpit `Lab published: <scene name>` to the owner. Restore `Before class` via `alertdialog "Restore checkpoint"` → new revision byte-identical to the snapshot; a co-tutor's stale save gets 412 and the conflict dialog. |
| 6 | Lab on a phone | `/lab/<token>` at 390 px, reduced motion: stage on top, bottom sheet tabs `Parameters` and `Readouts`, sliders 44 px, Run/Pause/Step; the hash equals the one on a laptop and `POST /api/labs/<token>/verify`. |
| 7 | Share and revoke | Share project → Create read-only link → `Link created`; Create and email link → Mailpit `<sharer> shared <project> with you`. `/view/<token>/s/<sid>` follows new revisions within 5 s; revoke → open view replaces itself with the level-1 dead-link heading within 5 s; every `/api/view/<token>` path answers `404 link_not_found`. |
| 8 | Viewer review | Priya signs in → `/w/<okafor id>`; Slope trial shows `View only`, values as `<label>: <value>` rows, Run works; Activity pages 50 at a time with `Show older`; a session ended in another tab sends the log to `/sign-in?return=%2Fw%2F<id>%2Factivity` and back after sign-in. |

## 2. Palette (all from DESIGN.md `## Palette`)

| Role | Hex | Source |
|---|---|---|
| ground | `#1e1e2e` | brief: Colour roles (very dark navy) |
| surface | `#313244` | brief: Colour roles |
| border | `#45475a` | brief: Colour roles |
| border-strong | `#6c7086` | decided: essential control boundaries need 3:1 (brief: Size and contrast) |
| ink | `#cdd6f4` | brief: Colour roles |
| muted | `#9aa0b9` | decided: lightened from the seed so muted ink passes AA on ground (brief: Size and contrast) |
| accent | `#89b4fa` (text on fills `#1e1e2e`) | brief: Colour roles |
| go | `#a6e3a1` | brief: Colour roles |
| publish | `#cba6f7` on `#45385a`, outline `#cba6f740` | brief: Colour roles |
| warning | `#f9e2af` | brief: Colour roles |
| danger | `#f38ba8` | brief: Colour roles |
| sky / grass | `#87ceeb` / `#3b8a36`, only inside the stage | brief: Colour roles |
| telemetry card | `#1e2e38` at 90% | brief: Components |

## 3. Type, space, layout per viewport

- Type: Inter (400/600/700/900) for interface and the landing name, JetBrains Mono (400/700) for telemetry, hashes, readout values and glyphs; both self-hosted woff2 under `public/fonts` (brief: Type). Sizes 10 to 15 px steps of about a tenth, panel titles 11 px bold uppercase letter-spaced accent; landing name in heavy Inter (weight 900), very large, roughly a quarter of the viewport width on desktop (brief: Type); the word `Rampwright` spans 25% of the viewport width at every desktop width: it measures 5.96 em in Inter 900 at -0.02em tracking, so its font size is `clamp(40px, 4.2vw, 160px)`, e.g. 54 px tall and 320 px wide at 1280 (decided: the brief measures the name by its width on screen).
- Space: 4 px unit; toolbar 42 px (52 px below 600 px and on coarse pointers), chips 24 px, Publish chip 30 px, dividers 1 x 20 px (decided from the seed).
- 1000 px and up (1440x900, 1280x800, 1024x768): floating panels; Outline left under the telemetry card, Props below it, Inspector right below the camera widget, Assets along the bottom (brief: Screens and layout).
- 600 to 999 (768x1024): one right-hand column about two fifths wide, sections Outline, Inspector, Props, Assets.
- Below 600 (375x812, 390x844): one bottom sheet with tabs `Panels`, 50% of the viewport height (brief limit 60%), so the stage region keeps more than 40% of the height (decided: 50% leaves 43% even after the 52 px toolbar).
- Toolbar is one row and scrolls sideways when wider than the screen; the page never scrolls sideways (brief: Toolbar overflow).
- Working screens: panels at most 760 px wide at 1280, full width with a small margin at 768, full width with stacked table rows at 375 (brief: Working screens).

## 4. Motion

| Element | Trigger | Duration, easing | Reduced-motion substitute |
|---|---|---|---|
| Chips, tabs, rows | hover, press, state | 100 ms, ease; `color`, `background-color`, `border-color` only (brief: Motion and effects) | 0 ms |
| Panel open/close | Windows menu, close | opacity, at most 100 ms | 0 ms |
| Camera view buttons | click | 250 ms ease-out | instant |
| Run chip | R / Run | 100 ms colour only; panels and widget vanish with no fade (brief: Signature) | same cut, 0 ms |
| Telemetry | run | values refresh about twice a second in steps, step and hash together; update at once on Pause and Step | same |
| Landing scene | scroll 0 to 3000 px | pure function of scroll progress; `data-progress` with 3 decimals; reverses exactly | four stills at 0.000 / 0.333 / 0.667 / 1.000 |
| Edit-mode stage | none | no idle motion | none |

## 5. States per async action (copy verbatim from the brief, Feedback states)

Save status: `Saving...`, `All changes saved`, `Offline: changes will save when you reconnect.`, `Not saved: this scene changed elsewhere`, `Not saved: your hold on <object name> ran out`, `Not saved: live editing is paused`, `Not saved: you can no longer edit this scene.`, `Not saved: check the highlighted value`, `Restored checkpoint <label>`, `Restore blocked while others are editing objects`. Notices, Upload status, outage banners and empty states exactly as printed in the brief. Mail outage: invite, share and publish succeed with `delivery: "queued"`, the outbox drains in queue order every 10 s once SMTP returns, exactly once, dropping messages whose invite or link is no longer live. Valkey outage: shared edits `503 lock_store_unavailable`, banner and People here `Presence unavailable`, Run keeps working, recovery within 10 s. MinIO outage: uploads, checkpoints, restores, publishes and lab or asset downloads `503 storage_unavailable`, nothing recorded.

## 6. Breakpoints

Exactly three layouts: floating at 1000 and up, docked 600 to 999, phone below 600 (brief: Editor breakpoints; decided: no other breakpoint exists).

## 7. Media and licences

No fetched media. The landing scene is three.js primitives, the no-WebGL still is an inline SVG, icons and glyphs are drawn inline (original). Fonts: Inter and JetBrains Mono, OFL-1.1, listed in `app/assets.json` with their sha256. Packages are MIT, ISC or Apache-2.0 and listed in `app/THIRD_PARTY_NOTICES.md`.
