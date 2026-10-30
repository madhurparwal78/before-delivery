# TRUTH — Kitefold Parcel Moon (golden ground truth)

Every value says where it comes from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys, end to end

### 1. A guest's first delivery (brief: Journeys 1)
- Start: fresh browser, no cookie. `GET /api/me` → 401 → `POST /api/guest` → 201 Me (role guest, `Courier dddd`, 0 stamps, canvas satchel) and a 400-day `pm_session` cookie. Notices show "Packing your satchel…" then clear (brief: Feedback states).
- First frame: intro start pose (240 m from the centre on the courier's line, fov 40) with `data-camera=intro`, `data-intro=playing`; dives in 1500 ms (decided: middle of 1.2–1.8 s) to the follow pose; any key or tap skips.
- "Read Lantern oil for the mill" opens `dialog "Letter from Ottoline Fennick"`, unfolding from the mill door's screen point in 400 ms (decided: inside 0.3–0.5 s).
- "Take the parcel": button `aria-disabled=true`, letter stays `open` at 1.00, thread `idle`, no ribbon, no route id, `data-carrying=none` while waiting; a lost answer is retried up to 3 times ~1 s apart with the identical request ("Connection wobbly — trying again…").
- 201/200: letter folds (250 ms), `data-carrying=standard` at fold start; the thread starts when the fold reaches 0: pull-back 450 ms → unspool 625 ms → return 375 ms → walking (decided: inside the brief's ranges). "Parcel taken. Follow the teal thread." once. Provider: one `acceptances` row; `route_id` equals the answer's.
- Walking: route readout "Bearing NE 51°, 55 m" from the depot (brief: Seed data example); ring turns to the bearing; ribbon from courier to door; ≤ 4 m → `arrived`, "Arrived at Lantern Mill.", "Hand over parcel" appears.
- Hand-over: one ticket per acceptance; `handing` until a definitive answer; a network failure resends the identical request. 201 → `delivered`, notch `stamp`, ribbon gone within 250 ms, thanks letter unfolds, one stamp press to the new balance, "Delivered to Ottoline Fennick. +5 stamps." Provider: one delivery, one movement (courier +5, mint −5), ticket stored.
- A retired errand's accept answers `mission_not_live`: letter folds, "This errand is no longer posted.", row leaves the board, thread never leaves `idle`.
- End: reload shows 5 stamps; one acceptance; one movement.

### 2. Claim, history, shared laptop (brief: Journeys 2)
- "Claim this save" → email → `POST /api/auth/postbox-key` (no `return_to`) → "Check your inbox for a postbox key." Mailpit: From `Parcel Moon <postbox@kitefold.example>`, subject "Your Parcel Moon postbox key", body with `<base>/claim?token=…` once.
- Claim page redeems on load; 200 → "Save claimed. Your stamps travel with you now." + "Walk on Bramble" (return path `/`). Guest with progress merges once: movements keep ids and times (owned through `merged_into`), satchels combined, open parcel moved or dropped, tickets moved (courier's own win), report returned. Old cookie → 401 everywhere; the browser's presence streams move to the new session in the same transaction.
- Stamp history: 20 movements per page newest first, "+n stamps · Delivery" / "−n stamps · Outfitter", "Show older" with an HMAC cursor bound to the courier; every page's balance is the full sum.
- Sign-out: session ended and its presence rows deleted in one transaction; "Signed out. You're a guest courier again."; a new guest starts.

### 3. Rush race (brief: Journeys 3)
- Board heading "Rush board · <board_date> · <rush_left> left"; rows "Parcel s of n · title"; Claim named "Claim <title>, parcel <s> of <n>".
- Claim: "Claiming…" with `aria-disabled` until the answer; 201/200 → "Yours", `data-carrying=rush`, thread plays, "It's yours! Deliver before HH:MM."; `parcel_taken` → "Taken", "Another courier got there first."
- One winner per parcel (row lock); holds end at commit + `RUSH_HOLD_SECONDS`; expiry judged per request; a lapsed parcel is claimable and listed once.
- Lapse noticed by a Me read at the hold end (server clock = Date header offset), a 10 s board refresh, or `hold_expired`; applied once: rewind, empty hands, Route text empty, "Your rush hold ran out. The parcel is back on the board." once.

### 4. Postcards (brief: Journeys 4)
- Photo mode: yaw 0, fov 50; arrows ±15° / ±5°, wheel ±5°, drag 1°/4 px, pinch ratio; fov 30–70. "Take postcard" renders 1200×800 with a perforated stamp edge and dated BRAMBLE postmark → PNG upload → MinIO `postcards/<id>.png` + record → "Postcard saved to your postbox."
- Mail: one ticket while the address is unchanged; "Postcard mailed to <email>."; Mailpit From `<name> via Parcel Moon <postcards@kitefold.example>`, Return-Path `postcards@kitefold.example`, subject `<name> sent you a postcard from Bramble`, body `<name> took this postcard on Bramble: <share_url>`; at most 5 per rolling window; the 6th → "You've mailed a lot of postcards. Try again in <m> minutes."
- Revoke → confirm → image deleted, record deleted; share page 404 "This postcard has been returned to sender."

### 5. Darkroom down (brief: Journeys 5)
- `/api/status` darkroom closed; Photo mode status reads the outage copy and the shutter is `aria-disabled`; walking and delivering continue; recovery within 10 s without restart (failures reused ≤ 5 s, probes cached 2 s — decided).

### 6. Founder console (brief: Journeys 6)
- Non-founder: refusal card "Only the founder can open the console." + "Walk on Bramble"; guests/no session also get Email + "Send postbox key" with `return_to` = path + query; claim page then shows "Open the console".
- Editor in the URL (`?mission=<id>|new`); save/move focus rules; If-Match on every change; 412 → "This mission changed in another tab. Reload it to see the latest."; Back/Forward with unsaved edits → "Discard changes?" with focus on "Keep editing".
- Scheduling in studio wall time: skipped times refused, repeated times resolve to the earlier instant; window −60 s … +366 days; scheduled missions go live by themselves (250 ms sweeper + lazy promotion on reads — decided).
- Studio zone change re-renders Goes live cells and "Today's board"; every load and 5 s refresh reads the studio zone before the missions, so a Goes live cell is never drawn in any other zone (decided: brief Goes live cells "in the current studio time zone"); Online now "<n> couriers on Bramble (<g> guests, <s> signed in)".

### 7. Moderation by keyboard (brief: Journeys 7)
- Drawer rows sorted by name (code point) then reference; Tab: toggle, Rename per row, then Close; focus kept on the same element through reloads; mute clears the stored emote in the same transaction; audit entries snapshot names.

### 8. Phone, touch, reduced motion (brief: Journeys 8)
- 375×812: tabs Postbox / Depot board / Satchel open sheets ≤ half height; stick bottom-left, Jump bottom-right, ring 150 px between; reduced motion: no intro, still sky, no camera moves, whole ribbon then tenths, ring at 0 with the readout on screen, arrival announced in the Route region.

## Palette (decided values for the brief's roles; DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| paper | #F6EEDD | brief: warm off-white paper; hex decided |
| paper shade | #EBDFC4 | decided |
| ink | #2B2140 | brief: deep inky violet; hex decided |
| riso pink | #E2457A | brief: bright riso pink; hex decided |
| route teal | #1F7F7A | brief: exactly rgb(31,127,122) |
| sun yellow | #F2BE3A | brief: sun yellow; hex decided |
| kraft | #A9814F | decided: brown paper box |

## Type, space and layout

- Fraunces 600/700 (headings 19/23/28 px, balance 40 px, metres 28 px); Atkinson Hyperlegible 400/700 body 16 px (brief: Type; sizes decided, ×1.2 steps).
- Tap targets ≥ 44 px; card padding 18 px (brief: Density; values decided).
- 1280×800: cards 288 px in the corners; ring 600×112 centred at the bottom; tools row bottom-right. 768×1024: cards 232 px; ring 420×96; tools column right edge; stick bottom-left with Satchel above it. 375×812: tabs, sheets, ring 150×48 (brief: Viewports; decided values inside the stated ranges).

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Notice | new / cleared copy | 200 / 200 ms, slide 10 px | ease-print | appears / clears at once |
| Letter | open / close | 400 / 250 ms | ease-print | appears / removed at rest |
| Stamp press | balance change | 250 ms + 500 ms glow | ease-print | numeral swaps; presses still counted |
| Intro dive | load | 1500 ms, fov 40→55 | ease-in-out | `data-intro=off` |
| Pull-back / unspool / return | parcel answer | 450 / 625 / 375 ms | ease-in-out / ease-print | straight to walking, camera still |
| Delivered fade / rewind | hand-over / drop or lapse | 250 / 320 ms | linear | cleared at once |
| Follow settle | courier stops | 400 ms | ease-print | rigid follow |
| Turn ramp | turn starts/stops | 200 ms | linear | instant |
| Photo ease / switch | step / open-leave | 220 / 380 ms | ease-print | instant |
| Figure glide / fade / bubble | presence read | 1000 / 300 / 200 ms | linear / ease-print | instant |
| Cloud ring | visible page | 90 s per turn | linear | still |

## States per async action

Pending, success, error and outage copy exactly as brief: Feedback states (every row), shown in `status "Notices"`; field errors under the field as its accessible description.

## Media

All drawn from code (brief: DP-45). Fonts: Fraunces and Atkinson Hyperlegible woff2 from Fontsource 5.3.0 (OFL-1.1); icons: Lucide 1.63.0 paths (ISC). See `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
