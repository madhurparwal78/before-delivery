# TRUTH — Orrery Studio golden

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys — ideal end-to-end flow

### 1. From visitor to trial (DP-01, DP-02, DP-10)
- Start: no session. `/` shows the h1 "3D scenes your whole team can trace" and five sections with rail numerals 01–05 (brief: Screens and layout › Home).
- Pricing: `radiogroup "Billing period"` starts on Monthly; `table "Compare plans"` shows Team $96.00 / month, Business $380.00 / month, extra seats $12.00 / $16.00, "Up to 5" / "Up to 25", "Included" twice; Annual shows $960.00 / $3,800.00 / $120.00 / $160.00 per year (brief: Business rules › Plans and prices).
- "Start free trial" → `/signup`; the form "Start your trial" posts `/api/signup`; the response sets `orrery_session` (HttpOnly, SameSite=Lax, Path=/) and the browser lands on `/app`.
- End: dashboard tiles read "1 of 8 seats used", "Trial ends <local time>", "0 scenes, 0 published", "0 active agent tokens". Provider records: workspace, owner member, trial subscription (`trialEndsAt` = creation + `TRIAL_LENGTH_SECONDS`), audit `workspace.created`.

### 2. Setting up the team (DP-05, DP-07, DP-09, DP-11)
- Admin opens Members → "Invite member" → email + role → "Invitation created for <email>. The email is on its way."; seats used +1.
- Mailpit: one message from "<admin name> via Orrery Studio" <studio@orrery-labs.test>, subject `Join <workspace name> on Orrery Studio`, body holds `<APP_PUBLIC_URL>/invite/<token>` (brief: Services › Mailpit).
- Invitee opens the link, form "Join workspace", "Join <workspace name>" → member with the invited role, session, dashboard; audit `member.joined`.
- Admin issues an edit token on Agents: region "New token" shows `orr_…` once with "Copy this token now. It will not be shown again."; audit `token.issued`.
- Audit trail lists the invitation, the join and the token issue newest first with actors.

### 3. Building with teammates and an agent (DP-13, DP-17, DP-19–DP-22)
- Editor opens "Arc One headphones": three-column drafting table, timeline ruler beneath with 9 ticks (circles for people, squares at 4 and 5 for the agent).
- Selecting "Left cup" claims its lock (PocketBase `object_locks`), Up nudges Position X by 0.1 and commits at once (field "Pending" until the server answers), a clearcoat layer is added from the "Layer type" menu; each change adds a tick and the viewport hash follows.
- A second editor sees presence ("<name> · Left cup") and the treeitem description "Locked by <name>"; committing on the held cup opens "Object locked" with focus on Cancel; "Take over" moves the lock, applies the value and the first editor reads "<name> took over Left cup."
- The agent's batch (bearer token) appears as square ticks; each author's Undo touches only their own batches.

### 4. Rewind and restore (DP-25–DP-28)
- Dragging or stepping the "Operation log" slider redraws the viewport at that operation before the next frame (`data-op-seq`, `data-graph-hash`), outlines changed nodes for 420 ms (`data-highlighted`), counts inspector numbers over 240 ms, fades later ticks to 0.35 over 160 ms, and on settling announces "Operation N of L: <type> on <node> by <author> (<person|agent>) at HH:mm:ss" (or "Start of log").
- "Restore as new operation" appends one batch of inverses (`restoreTo` = N); the scene's hash equals the hash at N; history before is unchanged; audit `scene.restored`.
- Restoring across seed seq 7 appends `state.remove st_hover` after the inverses that clear its transition and override (brief: Operations — `state.add`'s stored inverse is a `state.remove` of that ID).

### 5. Review and approval (DP-32–DP-37)
- Save version → snapshot `{seq, graph, hash}` in MinIO; Submit for review; a viewer switches states, pins a comment to "Headband" with an @mention picked from `listbox "Mention a teammate"`, then approves (never the creator).
- Review link (≥43 URL-safe characters from 32 random bytes) opens `/review/<token>` without sign-in: header "<scene> v<n> · <label> · Review copy · read only", States, orbit; no comments, op log or names. Revoke → "This review link is not valid."

### 6. Scheduled launch (DP-38–DP-42)
- Schedule in the workspace zone (`Publish date`, `Publish time`, "Time zone: <IANA zone>") → "Version N goes live <local time>." and the confirmation mail.
- At `publishAt` by the server's clock (never early, within 2 s) the payload goes to `ws/<ws>/published/<embedId>/scene.json`, the previous published version is withdrawn, audit `version.published` by "Orrery scheduler", and one publish notice to the scheduler and the creator.
- `/embed/<embedId>` renders it, turns when idle, reacts to hover and click; "Create export" → "Export ready." → zip with `scene.json`, `assets/<id>.<ext>`, `viewer.html`.

### 7. Paying for the workspace (DP-43–DP-46, DP-48, DP-51)
- Billing manager picks Team/Business, Monthly/Annual, extra seats, card → "Start paid plan" (Idempotency-Key) → Kill Bill account (`AUTO_PAY_OFF`, external payment method), subscription with a seat add-on quantity, invoice; PDF stored, PURCHASE recorded with key `<ws>:<key>`, receipt `Receipt for invoice <n>: $<amount>` to owner and billing managers; "Payment recorded for invoice <n>. A receipt is on its way."
- "Preview change" shows Kill Bill's dry-run amount "Due today: $X"; "Change plan" charges exactly that invoice; seat increases charge immediately, decreases wait for the term end.

### 8. A failed payment (DP-49, DP-52, DP-54)
- A signed `payment.failed` event records a chargeback (reopening the invoice), `past_due`, day-0 notice, banner on every app screen for every member "Payment failed. Pay invoice <n> by <local time> to keep publishing."; day 3 reminder; at `graceEndsAt` suspended + suspension notice.
- Paying the invoice records `invoice.paid` (payer) then `subscription.reactivated` (scheduler); the banner clears within 5 s.

## Decisions where the brief is silent

| Topic | Value | Source |
|---|---|---|
| New scene graph | root "Scene", "Main camera" and "Key light" as in the seed's seq 0 | decided: the seed's starting nodes are the brief's only starting graph |
| State named in "Cannot undo: a later change removed or uses state <state name>." | the editor dry-runs the caller's next undo (or redo) batch on the latest graph and names the state of the first operation that fails; the API body stays `{"error":"undo_conflict","nodeId":null}` | decided: the brief's conflict body carries only `nodeId` (null for a state) while its copy names the state, and the editor already holds the log and graph |
| Removing an absent camera view / transition / override | succeeds as a no-op | decided: the table names null as "clears", which is idempotent |
| Refunds | Kill Bill payment REFUND, the invoice stays paid | decided: refunds "do not change seats or plan"; an invoice-adjusting refund would reopen a balance |
| Past-due banner audience | every member on every app screen; `GET /api/me` carries the reopened invoice's number (`overdueInvoice`) so roles that cannot read invoices still see it | brief: Feedback states › Service status ("shows on every app screen while its condition holds"); field decided |
| Lock badge | all holders shown, "You" for the caller | decided: makes the brief's lock indicator readable |
| Thumbnails | captured from the editor viewport after "Save version"; inlined into the page shell for no-WebGL views | decided: the brief stores thumbnails but names no read route |
| Editor status display | the live region is visually hidden; the same copy shows as a corner notice | decided: one region for screen readers, visible confirmation for sighted users |
| Review link target | the newest draft / in-review / scheduled version | decided: the panel creates links for one unpublished version |

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| Paper ground | #F4F0E6 | brief: Visual design › Colour (warm off-white); hex decided |
| Ink | #1C1E17 | brief: near-black ink with an olive cast; hex decided |
| Ink muted | #545748 | decided: AA secondary text |
| Cobalt | #1F4FD8 (deep #173DA8) | brief: saturated cobalt for actions, selection, focus, rewind outline |
| Vermilion | #E0461F bars/icons, #B5321A small text, #C83A1A destructive fill | brief: vermilion alerts, darkened on small text |
| Putty | #CFC6B4 rules; grid at 42 % | brief: putty rules, panel borders, background grid |

## Type, space and layout

| Item | Value | Source |
|---|---|---|
| Display | Space Grotesk 500/700 | brief: Type |
| Body | IBM Plex Sans 400/500/600, 15 px / 1.45 | brief: Type; size decided (compact density) |
| Numerals | IBM Plex Mono 400/500, tabular-nums | brief: Type |
| Heading steps | h4 18.75, h3 23.44, h2 29.3, h1 36.62 px (×1.25 each) | brief: one quarter larger per level |
| Grid | 8 px hairline grid on body, panels, tiles, dialogs | brief: Drafting-table feel |
| Controls | ≥ 44 × 44 px; pressed sink 1 px + inset shadow | brief: Density, Drafting-table feel |
| 1280 | home rail column + 12-col grid; editor 1fr / 3fr / 1fr over a full-width ruler; tiles 4 across; billing 2 columns | brief: Screens and layout |
| 768 | rail numerals above headings; editor viewport on top, hierarchy and inspector side by side, timeline last; tiles 2×2; billing 1 column | brief |
| 375 | numerals inline; nav behind "Menu"; editor viewport, timeline, tabs Hierarchy/Inspector/Comments/Versions; tables as cards; tiles stacked | brief |

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Buttons, rows, treeitems | hover | 160 ms colour tint | cubic-bezier(0.2,0,0,1) | instant |
| Controls | press | instant 1 px sink | — | same |
| Focus ring | focus | instant 2 px cobalt | — | same |
| Dialogs, side sheet | open / close | 240 ms in, 160 ms out; fade + 8 px slide (WAAPI) | ease-out / ease-in | fade only |
| Busy bar | pending control | 1000 ms linear, infinite | linear | static "Working…" |
| Rejected value | server refusal | 160 ms return; vermilion edge ~2 s | ease-out | instant |
| Rewind | playhead reaches N | redraw before next frame; outline 420 ms; count 240 ms; tick fade 160 ms | ease-out | jump, instant, `list "Changes"` |
| State preview | choose a state | transition duration or 250 ms | ease-out cubic | instant |
| Embed idle turn | 3 s without pointer | 360° per 30 s | linear | stopped |
| Embed hover / click | pointer | authored duration | ease-out cubic | jump to end state |
| Embed scroll | scroll position | proportional blend Rest→target | — | still follows scroll |

## States per async action

All copy is verbatim from brief: Feedback states (Service status banner; editor and timeline; assets,
comments, versions and review links; members and agent tokens; billing; sign-in and trial forms; public page
states). Pending controls are disabled with the busy bar or "Working…".

## Breakpoints

| Width | Query |
|---|---|
| ≤ 640 px | phone arrangement (375) |
| 641–1100 px | tablet arrangement (768) |
| > 1100 px | desktop arrangement (1280) |

## Media and licences

| Item | Licence | Source |
|---|---|---|
| Space Grotesk, IBM Plex Sans, IBM Plex Mono woff2 | OFL-1.1 | Fontsource 5.3.0 packages; listed in `app/assets.json` |
| Icons, diagrams, empty-state drawing, embed placeholder | original | drawn in code for this app |
| Scene thumbnails | original | rendered by the app from each scene's graph |
