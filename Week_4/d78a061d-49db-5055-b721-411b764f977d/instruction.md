# Graphite Hollow Linewright

Linewright is a browser game for hobby players and small creator communities who want to play as a hero they made themselves. Players can build a stick-figure hero from parts in a live 3D builder, pose it, or upload their own glTF 2.0 humanoid. They draw weapons freehand by mouse, finger or keyboard cursor and watch the strokes turn into solid 3D objects. They play one solo story chapter by chapter, and two co-op stories with up to three friends whom they gather through a social lobby.

The server does four jobs:
- It checks every upload and every drawn weapon against a published, versioned rulebook.
- It runs the game world on a fixed step.
- It decides every countdown.
- It keeps every realtime stream consistent across dropped connections and server restarts.

Every screen, message and email stays in the language the player picked: English, 日本語 or Español.

The product uses three backend services:
- Postgres is the system of record.
- MinIO stores uploaded model files and their thumbnails.
- Mailpit receives the sign-up verification and password-reset emails over SMTP.

Out of scope: payments, a marketplace, voice chat, user-made levels, any datastore other than Postgres and MinIO, and any language beyond the three listed.

## Problem and users

Doodle-style hero games are flat and single-player, so no friend ever sees the hero a player drew. Avatar platforms do accept 3D uploads, but their acceptance rules are spread across performance tiers. Triangle counts, bone counts, rest-pose rules and file caps differ per platform, desktop tools check them, and the results come back in English jargon. A rejected upload tells a 13-year-old in Osaka or a parent in Seville almost nothing about what to fix, so players lose evenings re-exporting models that fail for reasons they cannot see.

Co-op parties fall apart in two ways. When one friend's connection drops, the session either will not take them back or takes them back and replays half the chat. When it drops a second time, the countdown has already run out. Localised games still show stray English notices, raw message keys and system chat lines, so a player who picked Japanese ends up reading three languages on one screen. Players pay in lost hours and abandoned co-op nights. Small studios pay in support tickets.

- **Player** (daily): builds and poses a hero in the 3D builder, draws a weapon and plays the solo story chapter by chapter with progress saved, entirely in their chosen language.
- **Party leader** (weekly): gathers 2 to 4 friends into a party, runs the ready check, hands off leadership if needed and takes the party into a co-op story that resumes where the party left off.
- **Model creator** (occasional): uploads a self-made glTF 2.0 humanoid, reads a pass/fail report for each rule in their own language, fixes the model and equips the accepted version.
- **Returning co-op player** (weekly): drops out of a co-op session on a flaky connection, possibly more than once, and rejoins the same session and party from any of their tabs without losing their place or seeing anything twice.

## Journeys

1. **Sign up, land in the hangar, keep the language.** A new visitor arrives signed out at `/` in a browser set to Spanish, and the page is in Spanish. They pick 日本語 in the language picker and create an account. The verification email in their inbox is in Japanese. They follow its link and see the email-confirmed heading, with the picker still showing 日本語. They sign in and land on `/hangar`, where a default stick-figure hero stands in the 3D scene, and every word and the document title are Japanese. After signing out, `/`, `/signin` and `/forgot-password` are still in Japanese with 日本語 selected.
2. **Build, pose and save a hero by keyboard.** A signed-in Spanish-speaking player opens the builder. Using only the keyboard, they:
   - pick a square head and spring legs;
   - set Spine length to `1,25`;
   - raise the right arm to 45°;
   - choose the cobalt material and put a lantern in the left hand;
   - undo the last change and redo it;
   - open the save dialog and save to slot 2.

   While the server is thinking, the dialog's controls are disabled and Save shows the pending copy. Nothing is announced and no slot label changes. When the server confirms, the polite announcement names slot 2 in Spanish and focus is back on Save to slot.
3. **Draw and forge a weapon.** A player opens the forge with an empty armoury. With the keyboard cursor they place two points and commit a stroke. On a high-density tablet screen they add two more strokes with a finger. After each stroke, reach, weight, swing speed and the vertex budget update in place in their locale's number format, always describing the newest drawing. They press Forge. The plane turns away and fades, the weapon flies along an arc into the hero's posed right hand, and the hero catches it. The armoury lists the new weapon as equipped.
4. **Upload, fix, equip and keep a model.** On `/models`, a model creator uploads a `.glb` that has too many triangles and a hips bone rotated a quarter turn. They select it in the list, and focus stays on it. Upload status moves through stored, validating and a two-rule rejection, one stage at a time. The report stays open and the selection stays put throughout. The report shows the hips rotation as w, x, y, z. The creator uploads a fixed file, sees it accepted, presses Equip model, and their friends see that model in their next co-op session. Later they press Delete model while storage is down. They get the delete-outage banner, and the model stays listed, selected and equipped.
5. **Play a solo chapter and resume.** A player starts chapter 1 of the solo story. After the opening flythrough they collect the first ink mote, pass the checkpoint, collect a second mote and close the tab. When they start chapter 1 again, they appear at the checkpoint with only the first mote collected. They collect the rest, reach the open gate and land on `/stories/lantern-road/chapters/1/complete`.
6. **Gather a party and pass the ready check.** A party leader with two friends already in the party invites three more. All three press Join party at the same moment, and each button shows the pending copy. One lands on `/party/<party id>`. The other two stay on the invite page, read the party-full notice in their own languages, and never saw themselves listed as members. A member leaves, the two still-open invites race again, and exactly one wins. The leader starts the ready check. One member's device clock is hours off, and another member reloads mid-check, yet both timers show the server's time left. Everyone answers Ready and lands in the same co-op session.
7. **Drop twice, rejoin and finish together.** In a co-op session, a returning co-op player's connection silently drops while they press an emote key and send a chat message. The other members see a "Seat held" countdown, driven by the server, beside that player's name in the play page's member roster. The player comes back within the grace period and is in the same seat at the same spot. Their emote and message appear exactly once, and nothing they repeated is applied twice. Their connection drops again, the countdown starts fresh from the full grace, and they rejoin from a second tab. Meanwhile another member deletes their equipped weapon from the armoury in another tab, and their next swing does nothing. The party completes the chapter, and every member's screen moves to the chapter-complete page.
8. **Chat in the lobby on a phone through two outages.** On a 375-pixel-wide phone, a player opens the chat drawer and types a message of 280 emoji. The counter reads 280 of 280 and nothing is cut off. The connection drops, they press Send, and the message goes through once when the connection returns. After five quick messages, a second drop and a sixth message, they see the localised cooldown notice with their text still in the field. After the cooldown the message goes through once. The drawer stays open with its text across both drops.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-up to hangar journey** A visitor picks a language, creates an account, confirms it through the emailed link, signs in and sees the hangar entirely in that language.
- **DP-02 — Name and password limits** Display names and hero names must be 3 to 20 characters and passwords 10 to 128 characters, counted as user-perceived characters, and both the form and the API enforce this with the localised limit message.
- **DP-03 — Verification email in the account's language** Sign-up sends one verification email to Mailpit whose subject, body and language attribute are in the account's language, whatever the browser's language, and which holds exactly one link.
- **DP-04 — Single-use expiring email links** Verification and password-reset links work once, stop working when a newer link of the same kind is sent, and expire after the configured lifetime, with the published 410 answers and copy.
- **DP-05 — Password reset** A player can request a reset email, which arrives in the account's language, and set a new password through its link, after which the old password no longer signs in.
- **DP-06 — Sign-in lands on the hangar** Signing in lands on /hangar showing the equipped hero, and reloading or deep-linking /hangar shows the same screen.
- **DP-07 — Saved language choice** The language picker saves the choice for the visitor and the account, and every page is served with the matching language attribute and document title before any script runs.
- **DP-08 — Persistent unsent-verification notice** When mail is unreachable, sign-up still creates the account, records its verification email as not sent and shows the localised resend notice, which persists across reloads and sign-ins until a resend is accepted by the mail server or the email is verified, as qualified in Services.
- **DP-09 — Upload while storage is down** When object storage is unreachable, an upload answers 503, shows the localised upload-outage banner, which persists across reloads until a later upload or delete succeeds, and leaves no model record or object behind.
- **DP-10 — Boot and recover without restart** The app starts and answers its health check while mail or storage is unreachable, keeps every other feature working, and makes a fresh attempt on every use of that service, so it recovers without a restart once the service is back.
- **DP-11 — Build and save a hero** A player assembles and poses a hero from parts, proportions, a right arm raise, a material and socket accessories in the live 3D builder and saves it to a slot.
- **DP-12 — Keyboard-complete builder** Every builder control works by keyboard, focus is always visible, and Tab order follows the published order, with Right arm raise after Shin length and before Undo.
- **DP-13 — Builder undo and redo** Undo and redo buttons and their shortcuts step through the last 50 builder changes from any builder control except the hero name field.
- **DP-14 — Save slot dialog** The save dialog keeps Tab and Shift+Tab inside itself, closes on Escape, returns focus to its opener after a save or cancel, and announces a confirmed save in the Notifications live region.
- **DP-15 — Stale slot saves rejected** Saving a slot with an out-of-date revision answers 412 and shows the localised stale-slot message without overwriting the newer hero.
- **DP-16 — Builder layout and inert bottom sheet** The parts rail and inspector sit beside the scene at 1280 pixels wide and become a bottom sheet below 1024 pixels whose collapsed part is inert, with no horizontal overflow at any published viewport.
- **DP-17 — Touch orbit and zoom** On touch screens, one-finger drag orbits and two-finger pinch or spread zooms the hero preview within the published limits, publishing the running gesture and never scrolling or zooming the page, also under reduced motion.
- **DP-18 — Draw and forge a weapon** A player draws strokes on the 320-CSS-pixel drawing plane by mouse, touch or keyboard cursor, whose Up key raises data-cursor-y, presses Forge, and the weapon is saved to the armoury and equipped in the hero's right hand.
- **DP-19 — Server-derived weapon stats** The server derives reach, weight, swing speed and vertex count from the stroke geometry with the published formulas, the same for every viewer.
- **DP-20 — Live stats and vertex budget** After every stroke, undo or clear, the stats and the vertex budget meter update in place in locale-formatted numbers within half a second, and an exceeded limit is shown immediately with no page reload, as qualified in Interactions.
- **DP-21 — Weapon limits at form and API** A weapon with 0 or more than 24 strokes, more than 12,000 vertices, or out-of-range points or thickness cannot be forged from the form and is refused by the API with the localised limit message, as qualified in Business rules.
- **DP-22 — Ink-to-steel lift** Committing a stroke inflates it into a tube and Forge flies the weapon into the posed right hand through the published phases and timings, ending with the grip on the hand and the server's weapon ID equipped, and reduced motion swaps in the published crossfade with the same end state.
- **DP-23 — Armoury** The armoury lists the player's weapons with their stats, equips and deletes them, and shows the published empty state when there are none.
- **DP-24 — Upload, fix and equip a model** A model creator uploads a .glb, reads the report for each rule, uploads a fixed version and equips the accepted one.
- **DP-25 — Upload intake checks** Uploads are checked for content type and glTF magic bytes, size-limited at 15 MiB while streaming, given a sanitised name and counted against a 60 MiB per-account quota.
- **DP-26 — Stored only after storage confirms** An upload appears as stored only after MinIO confirms the object, and validation starts only after that.
- **DP-27 — Versioned acceptance rulebook** Every upload is judged against the published rulebook R01 to R10, and the report gives a status, measured value and limit for each rule as the rulebook defines.
- **DP-28 — Originals kept with their verdict** Each upload is kept in MinIO byte for byte as submitted, and its verdict and rulebook version never change after they are written.
- **DP-29 — Announced upload stages** The pending, stored, validating and verdict stages are announced once each, in order, in the Upload status live region in the chosen language, each kept until the next replaces it, while the selected model, its open report and focus survive every re-render.
- **DP-30 — Only accepted models equip** Only an accepted model can be equipped on a hero, and a rejected or still-validating model answers 409.
- **DP-31 — Play a solo chapter** A player starts an unlocked solo chapter, collects the ink motes, passes the checkpoint and reaches the gate.
- **DP-32 — Authoritative fixed-step world** The server runs every session on a fixed 20-tick-per-second step from player intents, moving heroes 0.2 metres and puddle damage 0.5 health per tick, and every ack names the tick it applied on.
- **DP-33 — Saved solo progress** Solo progress, including unlocked chapters and the last checkpoint with its saved motes, is saved by the server, survives a restart and resumes at the checkpoint on return.
- **DP-34 — Chapter-complete route** Finishing a chapter takes every connected player in it to /stories/<story id>/chapters/<n>/complete within 2 seconds, that address reloads and deep-links to the same screen, and the server answers 404 for a viewer who has not completed that chapter.
- **DP-35 — Add a friend** A player sends a friend request by display name, the other player accepts it, and both see each other in their friends lists with presence.
- **DP-36 — Friend request rules** Friend requests follow the published idempotency, duplicate and self-request rules with exact status codes.
- **DP-37 — Presence across tabs** A friend's screen shows a player as online while any of their tabs sends heartbeats, keeps them online when one of several tabs closes, and shows offline within the published delays after the last heartbeat or last tab.
- **DP-38 — Gather a party** A verified party leader creates a party for a co-op story, invites friends, and sees them join the party lobby.
- **DP-39 — Invite acceptance lands on the lobby** Accepting an invite lands on /party/<party id>, and reloading or deep-linking that address shows the same lobby.
- **DP-40 — Fourth-seat race without ghost members** When several players accept invites to a party with one free seat at the same moment, exactly one joins and every other gets 409, stays on the invite page with the party-full message in their own language, and never sees themselves shown as a member.
- **DP-41 — Exactly one leader** A party always has exactly one leader, through handoff, the leader leaving and simultaneous leaves.
- **DP-42 — Localised party system lines** Party system chat lines are rendered in each viewer's own language with the published copy.
- **DP-43 — Ready check starts the session** When every member answers Ready, the party enters a co-op session of its chosen story and every member lands on its play route.
- **DP-44 — Server-timed ready check** The ready check's 20-second window is decided and counted by the server, every member's timer shows the server's remaining seconds whatever the device clock says, and neither a wrong clock nor a reload extends or ends it early.
- **DP-45 — Ready-check dialog by keyboard** The ready-check dialog takes focus, keeps Tab inside, answers by keyboard, can be reopened by any member while the check runs, and returns focus to where it was or to the published fallback.
- **DP-46 — Chat messages and limits** Lobby, party and session chat accept messages of 1 to 280 user-perceived characters, counted the same way as the Message counter, and a repeated send with the same client message ID creates one message.
- **DP-47 — Chat cooldown** A sixth message within 10 seconds in one channel answers 429 with Retry-After and shows the localised cooldown notice, idempotent replays are never charged, and no message is lost silently.
- **DP-48 — Inert chat drawer on phones** Below 768 pixels wide, lobby and party chat collapse into a drawer that is inert while closed, and the drawer keeps its open state and typed text across a reconnect.
- **DP-49 — Drop and rejoin a co-op session** A dropped member reconnects within the grace period, from any of their tabs, and is back in the same session, party, seat and position.
- **DP-50 — Server-held rejoin grace** The server decides and counts down the rejoin grace and settles it when it ends, whatever any client clock says, as qualified in Business rules.
- **DP-51 — At-most-once delivery across reconnects** After a reconnect, no chat line, emote, pickup or friend event shows twice, and every intent the client resends with its original ID is applied at most once.
- **DP-52 — Party story progress** A party's co-op progress per story is saved by the server and resumes at the party's next chapter and last checkpoint.
- **DP-53 — Emote wheel hotkeys** In a session, E opens the emote wheel and keys 1 to 6 send emotes whichever session control has focus.
- **DP-54 — Party heroes shared only in session** Session members receive each other's hero, weapon geometry and accepted model only through the running session they share, and a model stops being served within 1 second of being deleted or unequipped.
- **DP-55 — Account-scoped records** An account can read or change only its own heroes, weapons, models and progress, and any other account's ID answers 404.
- **DP-56 — One language on every surface** Once a language is chosen, no text, accessible name, title, language attribute, system line or email shows another language or a raw message key, apart from the published exemptions.
- **DP-57 — Scene motion and reduced motion** The hangar turntable, chapter flythrough, builder camera moves and button settle follow the published timings and scene state, each has its reduced-motion variant, and the scene has a still fallback without WebGL.
- **DP-58 — Paper-and-graphite look** The product looks like a hand-drawn sketchbook over a live 3D scene, with graphite outlines, warm paper and the published colour roles and type.
- **DP-59 — Run manifest, health and server boundary** The app runs from its manifest, answers the health check, and enforces the same-origin rules and request limits.
- **DP-60 — Real scene and server-side rules** The 3D scene, the outline shader, glTF validation and weapon derivation are real implementations on the server and in the browser, not stand-ins.
- **DP-61 — Latest drawing wins** Every forge preview carries a drawing revision and only the newest drawing's answer updates the stats, meter, markers and announcement, whatever order the answers arrive in.
- **DP-62 — Locale resolution order** Locale resolves as account, then lw_locale cookie, then Accept-Language, then en; signing in rewrites the cookie; and emails always use the account's locale.
- **DP-63 — Checkpoint keeps the motes held at it** Reaching the checkpoint saves exactly the motes collected at that moment, and motes collected later are saved only by reaching the checkpoint again or completing the chapter.
- **DP-64 — Streams survive restart** Event seq per stream and processed intent IDs persist across a server restart, so resume and duplicate acks keep working and seq never starts over.
- **DP-65 — Ready check survives reload** A reloaded member's tab reopens the running ready check by itself with the server's remaining seconds, focus on Ready if unanswered, and disabled answer buttons if answered.
- **DP-66 — Scene-drawn triangles and pinned validator** R04 counts the triangles the default scene draws per node and primitive mode, and R02 counts the errors reported by the glTF-Validator 2.0.0-dev.3.10.
- **DP-67 — Right arm raise** The builder's Right arm raise slider shows and accepts whole degrees from -180 to 180 in 15-degree key steps, the hero record stores pose.right_arm_raise in radians rounded half up to 4 decimals, and the posed hand moves data-hand-px and is where the lift ends.
- **DP-68 — Drawing plane coordinates** The drawing plane is a 320 by 320 CSS-pixel square at every viewport and pixel density, pointer positions are taken from its top-left corner in CSS pixels, and stroke points are stored in metres from the plane's centre with y up.
- **DP-69 — Model delete is all or nothing** Deleting a model removes both objects and the record, or answers 503 storage_unavailable with the localised delete-outage banner and leaves the record, status, quota, equipped heroes and session model unchanged, and an upload whose record write fails removes the object it wrote.
- **DP-70 — Deleted weapon gone everywhere** A deleted weapon answers 404, vanishes from the armoury in place, unequips from every hero, turns null in a running session's snapshot within 1 second so the next swing is acked no_weapon, and its number is never reused.
- **DP-71 — Removed member loses session access** During a dropped member's grace their model still streams to the session, and once their seat is released their session snapshot, session chat and model requests answer 404 within 1 second and their model stops streaming to everyone.
- **DP-72 — Upright rest pose (R10)** R10 judges the hips node's rotation, reported as glTF's [x, y, z, w] to 4 decimals and shown in the report as w, x, y, z in locale format, failing when |w| is below 0.9999 or the hips use a matrix and skipped when R01, R02, R05 or R06 failed.
- **DP-73 — Character counters** Message and Hero name show a live counter of used and allowed user-perceived characters, text over the limit stays in the field with the limit copy, and the API refuses it with 422.
- **DP-74 — Numeric seq and tick** seq, tick and weapon number are JSON integers in every REST and realtime message, after_seq is a decimal integer, and resume works across seq 9 to 10.
- **DP-75 — Ready-check deadline** Party.ready_check.deadline_at is the check's end in whole Unix seconds by server time, and the dialog timer shows remaining_seconds and never reads the device clock.
- **DP-76 — Fresh grace per drop** Every drop starts a fresh full grace, the seat belongs to the account so any of its tabs can rejoin, a member with two session connections drops only when the last closes, and dropped, rejoined and removed lines post once per drop.
- **DP-77 — Language picker on every public page** The Language combobox is on /, /signup, /signin, /forgot-password, /reset-password, /verify, the not-found page and the hangar, and signed-out pages keep the account's last locale after sign-out.
- **DP-78 — Honest save dialog** Pressing Save disables the dialog's controls with the pending copy, changes no slot label and announces nothing until the server answers, and on 412 the dialog keeps the server's slot name, the builder's edits and its undo history.

## Frontend

### Screens and layout (DP-06, DP-11, DP-16, DP-18, DP-23, DP-24, DP-31, DP-34, DP-38, DP-48, DP-58, DP-68, DP-77)

The live 3D scene always fills the viewport, and a sketchbook-like 2D layer sits on top of it.

- **Signed-out pages.** These are the home page `/`, sign-up `/signup`, sign-in `/signin`, forgot-password `/forgot-password`, the reset form `/reset-password?token=<token>` and email confirmation `/verify?token=<token>`. Each shows a paper card over a slowly turning sample hero. The card holds the language picker, then the page's form or heading, then a link to the other form where one applies.
- **Hangar `/hangar`.** The equipped hero stands centred in the scene, in its saved pose. The inspector shows:
  - the hero name as the level-1 heading;
  - the equipped weapon, with its localised "Weapon <n>" name and stats;
  - the equipped model's name, if any;
  - the language picker;
  - while the email is unverified, the verification notice, or the alert banner from Feedback states when the account's verification email is not sent.

  With no hero, the hangar shows the build-your-first-hero heading and a link to the builder.
- **Builder `/builder` (new hero) and `/builder/<character id>`.** The scene shows the hero preview. The parts rail holds head, torso, arms, legs, material and sockets. The inspector holds:
  - the hero name with its character counter;
  - the seven proportion sliders;
  - the Right arm raise slider;
  - Undo, Redo and Save to slot.
- **Forge `/forge`.** The hero preview stands in the scene with the drawing plane beside it. The drawing plane is a square exactly 320 by 320 CSS pixels at every viewport and every device pixel density. While the lift is idle, it shows the whole 2 by 2 metre drawing area square-on: the left edge is x −1, the right edge x 1, the top edge y 1 and the bottom edge y −1, with the centre at (0, 0). The plane never covers the hero's right hand on screen. The inspector holds the stroke thickness slider, the stats region, the vertex budget meter, Undo stroke, Clear plane and Forge.
- **Armoury `/armoury`.** The player's weapons as cards with stats and equipped state, or the empty state.
- **Models `/models`.** The upload button, the "My models" list and the "Upload report" region, with the storage alert banner above them while the account has a storage notice. Each list item holds a button named by the model's file name, with its status and thumbnail. The selected item's button carries `aria-current="true"`. The report region shows the selected model's report.
- **Stories `/stories`.** The solo story and the two co-op stories, with their chapters and the player's progress. Solo chapters have play buttons, and co-op stories point to the lobby.
- **Lobby `/lobby`.** The friends list with presence, the friend request form, incoming requests, pending party invites (each linking to its invite page), the create-party control and lobby chat.
- **Party lobby `/party/<party id>`.** The members list, where each member shows the leader mark when they lead, the presence word while their connection is `connected` or `offline`, and the seat-held line while it is `dropped` (as Business rules defines). Then the co-op story picker; invite buttons for friends not in the party; the ready-check controls; Leave party; party chat.
- **Invite `/invite/<token>`.** The inviting leader's name, the story, the member count and Join party.
- **Play `/play/<session id>`.** The full-screen game view with health, objective, the session members roster, the session events log, the emote button and session chat. The roster lists every member of the session; each item shows the member's display name and, while that member is dropped, the seat-held line. Without WebGL, a flat top-down drawing of the same layout appears, with the same roster.
- **Chapter complete `/stories/<story id>/chapters/<n>/complete`.** The chapter-complete heading, the motes collected, Next chapter (when one exists), Back to stories, and Back to lobby for the leader of a co-op party.
- **Not found.** Unknown routes show the not-found heading and the language picker inside the normal page frame. So does a chapter-complete route the viewer may not see, as Server boundary states.

Viewports and arrangement:

| Viewport | Navigation | Parts rail and inspector | Lobby and party chat |
|---|---|---|---|
| 1280x800 | Full-height left rail of tabs with torn-paper edges | Parts rail on the left beside the navigation; inspector card on the right, about a quarter of the width; scene between them | Side panel on the right, always visible |
| 768x1024 | Row of icon tabs across the top, each named by its label | One bottom sheet over the scene, either collapsed to the handle row plus the Head picker or expanded to at most 60% of the height | Side panel, visible below the members list |
| 375x812 | Same row of icon tabs across the top | Same bottom sheet | Collapsed into the chat drawer, opened by its button |

- The bottom sheet applies at every width below 1024 pixels, and the chat drawer at every width below 768 pixels.
- No published viewport scrolls sideways.
- In the open bottom sheet, the parts sections come first and the inspector controls follow, in the same order as on desktop.
- In the forge at 375x812, the drawing plane sits below the hero preview and is still 320 CSS pixels square.
- On the play page the session members roster stays visible at every published viewport, in the top corner opposite the health meter.

### Public screens and controls (DP-12, DP-14, DP-17, DP-18, DP-22, DP-23, DP-27, DP-29, DP-34, DP-42, DP-45, DP-48, DP-53, DP-56, DP-57, DP-67, DP-72, DP-73, DP-77)

Only the roles, names and scene state attributes below are public. Tests in Japanese or Spanish address controls by the names in those columns. `<n>`, `<name>` and `<seconds>` are filled in as each row states.

| Role and English name | 日本語 | Español | Where and what |
|---|---|---|---|
| navigation "Main" | メイン | Principal | Rail or top tabs |
| link "Hangar" / "Builder" / "Forge" / "Armoury" / "Models" / "Stories" / "Lobby" | 格納庫 / ビルダー / 工房 / 武器庫 / モデル / ストーリー / ロビー | Refugio / Taller / Forja / Armería / Modelos / Historias / Sala | Tabs, in this order |
| combobox "Language" | 言語 | Idioma | On `/`, `/signup`, `/signin`, `/forgot-password`, `/reset-password`, `/verify`, the not-found page and the hangar inspector; options always read `English`, `日本語`, `Español` |
| status "Notifications" | お知らせ | Avisos | Polite region on every page |
| alert (no name) | | | Outage banners and the unsent-verification banner |
| textbox "Email" | メールアドレス | Correo electrónico | Sign-up, sign-in, forgot password |
| textbox "Password" | パスワード | Contraseña | Password input |
| textbox "Display name" | 表示名 | Nombre visible | Sign-up |
| button "Create account" | アカウントを作成 | Crear cuenta | Sign-up |
| button "Sign in" | サインイン | Iniciar sesión | Sign-in |
| link "Forgot password?" | パスワードをお忘れですか? | ¿Olvidaste tu contraseña? | Sign-in |
| button "Send reset link" | 再設定リンクを送信 | Enviar enlace | Forgot password |
| button "Set new password" | 新しいパスワードを設定 | Guardar contraseña | Reset form |
| button "Resend email" | メールを再送信 | Reenviar correo | Hangar, while unverified |
| region "Equipped hero" | 装備中のヒーロー | Héroe equipado | Hangar inspector |
| application "Hero preview" | ヒーローのプレビュー | Vista previa del héroe | Focusable 3D preview in the hangar, builder and forge |
| region "Parts" | パーツ | Piezas | Parts rail or bottom sheet |
| button "Parts sheet" | パーツシート | Panel de piezas | Bottom-sheet handle, with aria-expanded true or false |
| radiogroup "Head" / "Torso" / "Arms" / "Legs" | 頭 / 胴体 / 腕 / 脚 | Cabeza / Tronco / Brazos / Piernas | Part pickers |
| slider "Head size", "Neck length", "Spine length", "Upper arm length", "Forearm length", "Thigh length", "Shin length" | 頭の大きさ、首の長さ、背骨の長さ、上腕の長さ、前腕の長さ、太ももの長さ、すねの長さ | Tamaño de la cabeza, Largo del cuello, Largo de la columna, Largo del brazo, Largo del antebrazo, Largo del muslo, Largo de la espinilla | Proportion sliders, in this order |
| slider "Right arm raise" | 右腕の角度 | Ángulo del brazo derecho | Pose slider, after Shin length; value text `<n>°` |
| radiogroup "Material" | 素材 | Acabado | Six swatches |
| radiogroup "Head socket" / "Back socket" / "Left hand socket" | 頭のソケット / 背中のソケット / 左手のソケット | Anclaje de cabeza / Anclaje de espalda / Anclaje de mano izquierda | Accessories |
| textbox "Hero name" | ヒーロー名 | Nombre del héroe | Inspector; its accessible description is its counter `<used>/20` |
| button "Undo" / "Redo" | 元に戻す / やり直す | Deshacer / Rehacer | Inspector |
| button "Save to slot" | スロットに保存 | Guardar en ranura | Opens the save dialog |
| dialog "Save hero" | ヒーローを保存 | Guardar héroe | Save dialog |
| radiogroup "Save slot" with radio "Slot <n>" | 保存スロット / スロット<n> | Ranura / Ranura <n> | `<n>` is 1, 2 or 3; an occupied slot's radio also shows the hero name the server holds |
| button "Save" / "Cancel" | 保存 / キャンセル | Guardar / Cancelar | Save dialog |
| application "Drawing plane" | 描画面 | Plano de dibujo | Forge |
| slider "Stroke thickness" | 線の太さ | Grosor del trazo | Forge |
| button "Undo stroke" / "Clear plane" / "Forge" | 線を取り消す / すべて消す / 鍛える | Deshacer trazo / Borrar plano / Forjar | Forge |
| region "Weapon stats" | 武器の性能 | Estadísticas del arma | Forge: reach, weight, swing speed |
| meter "Vertex budget" | 頂点の上限 | Presupuesto de vértices | Forge |
| status "Forge stats" | 性能の更新 | Actualización de estadísticas | Polite region in the forge |
| list "Armoury" with button "Equip" / "Delete" per card | 武器庫 / 装備 / 削除 | Armería / Equipar / Eliminar | Armoury |
| button "Upload model" | モデルをアップロード | Subir modelo | Opens the file chooser, whose input is named "Model file" / モデルファイル / Archivo de modelo |
| list "My models" | マイモデル | Mis modelos | Models; one button per model, named by its file name |
| status "Upload status" | アップロード状況 | Estado de la subida | Polite region on Models |
| region "Upload report" | 検証レポート | Informe de validación | Selected model's report; its heading is the report heading |
| button "Equip model" / "Delete model" | モデルを装備 / モデルを削除 | Equipar modelo / Eliminar modelo | Selected model |
| button "Play chapter <n>" | 第<n>章をプレイ | Jugar capítulo <n> | Stories, solo story only |
| textbox "Friend's display name" and button "Send friend request" | フレンドの表示名 / フレンド申請を送る | Nombre visible del amigo / Enviar solicitud | Lobby |
| list "Friends" | フレンド | Amigos | Lobby; each item shows the friend's display name and presence word |
| button "Accept <name>" / "Decline <name>" | <name>さんを承認 / <name>さんを断る | Aceptar a <name> / Rechazar a <name> | Incoming requests |
| button "Create party" | パーティーを作成 | Crear grupo | Lobby |
| combobox "Co-op story" | 協力ストーリー | Historia cooperativa | Party lobby, leader only |
| list "Party members" | メンバー | Miembros | Party lobby; each item shows a member's display name, then the presence word while that member's connection is `connected` or `offline`, or the seat-held line while it is `dropped` |
| button "Invite <name>" | <name>さんを招待 | Invitar a <name> | Party lobby, leader only |
| button "Make <name> leader" | <name>さんをリーダーにする | Hacer líder a <name> | Party lobby, leader only |
| button "Leave party" | パーティーを抜ける | Salir del grupo | Party lobby |
| button "Start ready check" | 準備確認を開始 | Iniciar comprobación | Party lobby, leader only |
| button "Open ready check" | 準備確認を開く | Abrir comprobación | Party lobby, every member except the leader, only while a check runs |
| alertdialog "Ready check" | 準備確認 | Comprobación de listos | Every member |
| timer "Time left" | 残り時間 | Tiempo restante | Inside the ready-check dialog |
| button "Ready" / "Not ready" | 準備OK / まだ | Listo / No listo | Ready-check dialog |
| button "Join party" | パーティーに参加 | Unirse al grupo | Invite page |
| button "Open chat" / "Close chat" | チャットを開く / チャットを閉じる | Abrir conversación / Cerrar conversación | Drawer, below 768 pixels |
| dialog "Chat" | チャット | Conversación | The drawer |
| log "Messages" | メッセージ一覧 | Mensajes | Every chat panel |
| textbox "Message" and button "Send" | メッセージ / 送信 | Mensaje / Enviar | Every chat panel; Message's accessible description is its counter `<used>/280` |
| status "Chat status" | チャットの状態 | Estado de la conversación | Cooldown and send errors |
| application "Game view" | ゲーム画面 | Vista de juego | Play: the scene or its flat fallback |
| meter "Health" | 体力 | Salud | Play |
| status "Objective" | 目標 | Objetivo | Play |
| list "Session members" | セッションのメンバー | Miembros de la partida | Play; one item per member of the session, showing the member's display name and, while that member is dropped, the seat-held line |
| log "Session events" | セッションの出来事 | Eventos de la partida | Play |
| button "Emotes" and menu "Emotes" | エモート | Gestos | Play |
| menuitem "Wave", "Cheer", "Bow", "Laugh", "Point", "Shrug" | 手を振る、喜ぶ、おじぎ、笑う、指さす、肩をすくめる | Saludar, Celebrar, Reverencia, Reír, Señalar, Encogerse | Emotes 1 to 6, in this order |
| button "Skip" | スキップ | Saltar | Chapter flythrough |
| button "Next chapter" / "Back to stories" / "Back to lobby" | 次の章へ / ストーリーに戻る / ロビーに戻る | Siguiente capítulo / Volver a historias / Volver a la sala | Chapter complete |

**Counters.** Each counter sits directly after its field as visible text, in the locale's number format. `<used>` is the field's length counted the way Business rules counts text limits.

**Scene state attributes.** The 3D views publish what the camera, the drawing and the lift are doing as attributes on their elements, so the scene can be checked without reading pixels.
- The values are plain numbers and fixed words. They are never translated and are not visible text.
- Each one is updated on every animation frame while anything it describes changes, and holds its last value at rest.
- They are present with the same meaning in the still fallback without WebGL.

How each key, drag, wheel turn and pinch changes the values is stated in Interactions.

| Element | Attribute | Values |
|---|---|---|
| application "Hero preview" | `data-renderer` | `webgl` or `still` |
| | `data-orbit` | Camera angle around the hero's vertical axis in whole degrees, 0 to 359; 0 when the page opens |
| | `data-tilt` | Camera tilt in whole degrees, -10 to 60; 15 when the page opens |
| | `data-distance` | Camera distance from the hero in metres with two decimals, 2.00 to 6.00; 4.00 when the page opens |
| | `data-gesture` | `orbit` or `zoom` while a pointer or touch gesture on the preview runs, otherwise `none` |
| | `data-hand-px` | The hero's posed right-hand socket projected onto the preview, as `<x>,<y>` in whole CSS pixels from the preview element's top-left corner |
| | `data-turntable` | `on` while the hangar idle turn runs, otherwise `off` |
| | `data-camera-focus` | The builder parts section the camera is aimed at: `none`, `head`, `torso`, `arms`, `legs`, `material` or `sockets` |
| | `data-camera-moving` | `true` while a builder camera move runs, otherwise `false` |
| application "Drawing plane" | `data-cursor-x`, `data-cursor-y` | The keyboard cursor's position on the plane in metres with two decimals, -1.00 to 1.00; `0.00` and `0.00` when the forge opens |
| | `data-stroke-points` | Number of points in the stroke in progress; `0` when none is in progress |
| | `data-strokes` | Number of committed strokes in the drawing |
| | `data-lift` | `idle`, `inflating`, `flying`, `catching`, `crossfading` or `socketed` |
| | `data-tube-radius` | Current radius in metres, three decimals, of the most recently committed stroke's tube; `0.000` before any commit |
| | `data-plane-yaw` | The plane's turn around its vertical axis in whole degrees; 0 at rest |
| | `data-plane-opacity` | How visible the plane is, two decimals, from 1.00 (fully visible) to 0.00 (invisible) |
| | `data-arc-height` | The flying weapon's height in metres, two decimals, above the straight line from the plane's centre to the hero's right hand; `0.00` when not flying |
| | `data-grip-gap` | Distance in metres, three decimals, between the weapon's grip marker and the hero's right-hand socket; `0.000` in `socketed` |
| | `data-equipped-weapon` | ID of the weapon equipped on the hero shown, or empty |
| application "Game view" | `data-renderer` | `webgl` or `still` |
| | `data-flythrough` | `playing`, `still` or `done` |

Screen copy (headings, titles, labels, log lines). Copy for async results lives in Feedback states.

| Item | English | 日本語 | Español |
|---|---|---|---|
| Document title pattern | `<screen> · Linewright` | same pattern | same pattern |
| Screen names for titles: sign-in, sign-up, forgot password, hangar, builder, forge, armoury, models, stories, lobby, party lobby, invite, confirm email, reset password, chapter complete, not found | `Sign in`, `Create account`, `Forgot password`, `Hangar`, `Hero builder`, `Weapon forge`, `Armoury`, `My models`, `Stories`, `Lobby`, `Party lobby`, `Party invite`, `Confirm email`, `Reset password`, `Chapter complete`, `Page not found` | `サインイン`, `アカウント作成`, `パスワードをお忘れの方`, `格納庫`, `ヒーロービルダー`, `武器工房`, `武器庫`, `マイモデル`, `ストーリー`, `ロビー`, `パーティーロビー`, `パーティーへの招待`, `メールアドレスの確認`, `パスワードの再設定`, `チャプタークリア`, `ページが見つかりません` | `Iniciar sesión`, `Crear cuenta`, `Contraseña olvidada`, `Refugio`, `Taller de héroes`, `Forja de armas`, `Armería`, `Mis modelos`, `Historias`, `Sala`, `Sala del grupo`, `Invitación al grupo`, `Confirmar correo`, `Restablecer contraseña`, `Capítulo completado`, `Página no encontrada` |
| Play page title | `<story title> · Linewright` | same | same |
| Signed-out home title | `Linewright` | `Linewright` | `Linewright` |
| Empty armoury heading | `Your armoury is empty` | `武器庫はまだ空です` | `Tu armería está vacía` |
| Empty armoury text | `Draw a weapon in the forge to see it here.` | `工房で武器を描くと、ここに表示されます。` | `Dibuja un arma en la forja para verla aquí.` |
| Hangar with no hero | `Build your first hero` | `最初のヒーローを作ろう` | `Crea tu primer héroe` |
| Weapon name (`<n>` is the weapon's number) | `Weapon <n>` | `武器 <n>` | `Arma <n>` |
| Stat labels | `Reach`, `Weight`, `Swing speed` | `リーチ`, `重さ`, `振りの速さ` | `Alcance`, `Peso`, `Velocidad de golpe` |
| Stat values | `<reach> m`, `<weight> kg`, `<swing>/s` | same | same |
| Vertex meter text | `Vertices: <used> / <limit>` | `頂点: <used> / <limit>` | `Vértices: <used> / <limit>` |
| Over-limit marker on the meter | `Over the vertex budget` | `頂点の上限を超えています` | `Supera el límite de vértices` |
| Too many strokes marker | `Too many strokes` | `線が多すぎます` | `Demasiados trazos` |
| Report heading, accepted | `Model accepted` | `モデルが承認されました` | `Modelo aceptado` |
| Report heading, rejected (`<n>` failed rules) | `Model rejected: 1 rule failed` / `Model rejected: <n> rules failed` | `モデル不合格: <n>件のルールに違反` | `Modelo rechazado: 1 regla no superada` / `Modelo rechazado: <n> reglas no superadas` |
| Report heading while not judged | `Validation in progress` | `検証中` | `Validación en curso` |
| Report section headings | `Failed rules`, `Passed rules`, `Not checked` | `不合格のルール`, `合格したルール`, `未チェック` | `Reglas no superadas`, `Reglas superadas`, `Sin comprobar` |
| Report rulebook line | `Judged under rulebook <version>` | `ルールブック<version>で判定` | `Juzgado con el reglamento <version>` |
| Model statuses | `Stored`, `Validating`, `Accepted`, `Equipped`, `Rejected` | `保存済み`, `検証中`, `承認済み`, `装備中`, `不合格` | `Guardado`, `Validando`, `Aceptado`, `Equipado`, `Rechazado` |
| Chapter label | `Chapter <n>` | `第<n>章` | `Capítulo <n>` |
| Chapter complete heading | `Chapter <n> complete` | `第<n>章クリア` | `Capítulo <n> completado` |
| Objective | `Ink motes: <collected>/3` | `インクのしずく: <collected>/3` | `Gotas de tinta: <collected>/3` |
| Gate open objective | `The gate is open.` | `門が開きました。` | `La puerta está abierta.` |
| Event: pickup | `<name> collected an ink mote (<collected>/3).` | `<name>さんがインクのしずくを集めました（<collected>/3）。` | `<name> recogió una gota de tinta (<collected>/3).` |
| Event: emote | `<name>: <emote>` | `<name>: <emote>` | `<name>: <emote>` |
| Event: checkpoint | `Checkpoint saved.` | `チェックポイントを保存しました。` | `Punto de control guardado.` |
| Event: knocked out | `<name> was knocked out and returns to the checkpoint.` | `<name>さんが倒れ、チェックポイントに戻ります。` | `<name> cayó y vuelve al punto de control.` |
| Roster: dropped member (Party members and Session members) | `Seat held: <seconds> s` | `席を確保中: 残り<seconds>秒` | `Puesto reservado: <seconds> s` |
| Presence | `Online`, `Offline` | `オンライン`, `オフライン` | `En línea`, `Desconectado` |
| Ready-check timer | `<seconds> s left` | `残り<seconds>秒` | `Quedan <seconds> s` |
| Party system lines | see Business rules | | |
| No-WebGL notice | `3D view unavailable on this device.` | `この端末では3D表示を利用できません。` | `La vista 3D no está disponible en este dispositivo.` |
| Not found heading | `We couldn't find that page.` | `ページが見つかりませんでした。` | `No encontramos esa página.` |

Placeholders in this table:
- In the Ready-check timer, `<seconds>` is the `remaining_seconds` the server last sent.
- In the dropped-member roster line, `<seconds>` is that member's last-sent `grace_remaining_seconds`: from the latest party state in Party members, and from the latest session snapshot in Session members.
- In the emote event line, `<emote>` is the emote's menu item name in the reader's language.
- In the Right arm raise value text `<n>°`, `<n>` is the whole-degree angle in the locale's number format.

Rule titles, shown in the report and returned by the rulebook endpoint:

| Rule | English | 日本語 | Español |
|---|---|---|---|
| R01 | `File is a glTF 2.0 binary` | `glTF 2.0バイナリ形式である` | `El archivo es un binario glTF 2.0` |
| R02 | `No glTF validation errors` | `glTF検証エラーがない` | `Sin errores de validación glTF` |
| R03 | `Only supported extensions` | `対応している拡張機能のみ` | `Solo extensiones compatibles` |
| R04 | `At most 20,000 triangles` | `三角形は20,000以下` | `Como máximo 20.000 triángulos` |
| R05 | `One skin with at most 64 bones` | `スキンは1つ、ボーンは64以下` | `Un esqueleto con 64 huesos como máximo` |
| R06 | `All required humanoid bones` | `必須のヒューマノイドボーンがすべてある` | `Todos los huesos humanoides obligatorios` |
| R07 | `At most 8 materials` | `マテリアルは8以下` | `Como máximo 8 materiales` |
| R08 | `All textures embedded in the file` | `テクスチャはすべてファイルに埋め込み` | `Todas las texturas incrustadas en el archivo` |
| R09 | `Textures at most 2048 px per side` | `テクスチャは各辺2048 px以下` | `Texturas de 2048 px por lado como máximo` |
| R10 | `Hips upright at rest` | `腰ボーンが直立の基本姿勢` | `Cadera recta en reposo` |

Rule lines. Under each rule title in the report, exactly one of these lines appears. Which one depends on the rule and on the values the rulebook in Business rules defines for it:

| Case | English | 日本語 | Español |
|---|---|---|---|
| Rule judged with a number measured and a number limit (R02, R03, R04, R05, R07, R08, R09) | `Measured <measured>, limit <limit>` | `測定値 <measured>、上限 <limit>` | `Medido <measured>, límite <limit>` |
| R06 judged with bones missing | `Missing: <measured>` | `不足: <measured>` | `Faltan: <measured>` |
| R06 judged with nothing missing | `Nothing missing` | `不足なし` | `No falta ninguno` |
| R10 judged from a rotation | `Rotation w <w>, x <x>, y <y>, z <z>` | `回転 w <w>、x <x>、y <y>、z <z>` | `Rotación w <w>, x <x>, y <y>, z <z>` |
| R10 judged from a matrix | `Rest pose given as a matrix` | `基本姿勢が行列で指定されています` | `Postura de reposo indicada como matriz` |
| R01, pass or fail | `Checked from the file header` | `ファイルヘッダーで確認` | `Comprobado en la cabecera del archivo` |
| Any skipped rule | `Not checked because an earlier rule failed` | `前のルールが不合格のため未チェック` | `Sin comprobar porque falló una regla anterior` |

In the R10 rotation line, `<w>`, `<x>`, `<y>` and `<z>` are the four components of R10's `measured` value, each shown with exactly four decimals in the locale's number format. For example, a measured `[0, 0.7071, 0, 0.7071]` reads `Rotación w 0,7071, x 0,0000, y 0,7071, z 0,0000` in Spanish.

**Published exemptions from the one-language rule.** These are the only items that may appear in a language other than the active one:
- user-typed display names, hero names and chat bodies;
- model file names;
- the R06 bone names, which are the node names the model file must contain;
- the product name `Linewright`;
- the language picker's option names;
- the scene state attributes.

Story titles are in Seed data. Every other visible string, accessible name, `title` attribute and image `alt` text is yours to write, in each of the three languages.

### Interactions (DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-20, DP-21, DP-23, DP-29, DP-34, DP-40, DP-45, DP-48, DP-53, DP-61, DP-65, DP-67, DP-68, DP-69, DP-73, DP-77, DP-78)

**Builder**

- **Builder Tab order.** Navigation comes first. Then the Parts region: Head, Torso, Arms, Legs, Material, Head socket, Back socket, Left hand socket. Then Hero preview, Hero name, the seven proportion sliders in the published order, Right arm raise, Undo, Redo and Save to slot. In the bottom-sheet layout, the Parts sheet handle comes first in the Parts region. Each radiogroup is a single Tab stop, and the arrow keys move and select within it.
- **Collapsed bottom sheet.** While the sheet is collapsed, only its handle and the Head picker are visible and reachable. Nothing else inside the sheet can be focused or clicked, and none of it is in the accessibility tree. The handle toggles the sheet between collapsed and expanded on click, Enter or Space, and on a vertical swipe on touch screens. The builder's undo and redo shortcuts work in either state.
- **Proportion sliders.** Range 0.50 to 1.50 in steps of 0.05.
  - Arrow keys move one step, Page Up and Page Down move four steps, and Home and End jump to the ends.
  - The value text shows two decimals in the locale's number format (Spanish `1,25`, Japanese `1.25`).
  - Each key press is one undo step, and so is each finished pointer drag.
- **Right arm raise.** Range −180 to 180 whole degrees, starting at the hero's stored pose (0 for a new hero).
  - Arrow keys move it by 15, Page Up and Page Down by 45, and Home and End jump to −180 and 180. A value that is not a multiple of 15 moves from where it is (57 with Right gives 72).
  - The angle turns the hero's right arm around the shoulder's forward axis: 0 hangs the arm at the side, 90 holds it straight out to the side, 180 points it straight up, and negative angles swing it the other way, across the front of the body.
  - The arm moves within a tenth of a second of each change, and `data-hand-px` follows the hand.
  - When a saved hero opens, the slider shows its stored angle as whole degrees. For example, a stored 1.0 shows `57°`.
  - Each key press is one undo step, and so is each finished pointer drag.
- **Undo and redo.** Undo has its button and Ctrl+Z (Cmd+Z on Apple). Redo has its button and Ctrl+Shift+Z or Ctrl+Y (Cmd+Shift+Z on Apple).
  - The shortcuts work wherever focus is in the builder region, except the Hero name field, where the field's own text undo applies.
  - Up to 50 steps are kept, and a new change after an undo clears the redo steps.
  - Each button is disabled when it has nothing to do.
- **Hero name counter.** The counter updates on every keystroke, paste and deletion. The field never cuts off what the player types or pastes. Text outside the limit stays in the field, the counter turns brick red, and the limit copy appears under the field. Save to slot then shows the limit copy instead of opening the dialog.
- **Save dialog.** Save to slot opens "Save hero" with focus on the first radio. Each occupied slot's radio shows the name of the hero it holds.
  - Tab from the last control goes to the first, and Shift+Tab from the first goes to the last, so focus never leaves the dialog while it is open.
  - Escape or Cancel closes it without saving and returns focus to Save to slot.
  - Pressing Save sends the whole hero. Until the server answers:
    - Save, Cancel and the slot radios are all disabled, and Save shows the pending copy while keeping keyboard focus;
    - Escape does nothing;
    - no slot label changes, Notifications stays as it was, and the equipped hero and hangar are unchanged.
  - On 200 or 201 the dialog closes, the slot labels take the server's names, the save is announced, and focus returns to Save to slot.
  - On 412 the dialog stays open and the stale-slot copy is announced. The occupied slots' radios now show the hero names the server holds. Save, Cancel and the radios are enabled again, and focus is on Save. The builder's current edits, its slider values and its undo history stay exactly as they were.
- **Hero preview keys.** With the preview focused, each key press changes one scene state attribute by a fixed step:
  - Right adds 15 to `data-orbit` and Left subtracts 15, wrapping around the circle (Right from 350 gives 5, Left from 0 gives 345).
  - Up adds 10 to `data-tilt` and Down subtracts 10, stopping at the ends of the -10 to 60 range (Up from 55 gives 60, Down from 0 gives -10).
  - `+` lowers `data-distance` by 0.50, bringing the camera closer, and `-` raises it by 0.50, stopping at the ends of the 2.00 to 6.00 range.

  For example, from the opening values (orbit 0, tilt 15, distance 4.00), one press each of Right, Up and `+` gives orbit 15, tilt 25 and distance 3.50.
- **Hero preview pointer and touch.**
  - Dragging the mouse or one finger toward the right raises `data-orbit`, and toward the left lowers it, wrapping the same way. `data-gesture` reads `orbit` during the drag.
  - A wheel turn that would scroll a page down raises `data-distance`, and one that would scroll it up lowers it.
  - On touch screens, spreading two fingers apart lowers `data-distance` and pinching them together raises it. `data-gesture` reads `zoom` while two fingers are down.
  - Distance stays within 2.00 to 6.00, and `data-gesture` returns to `none` when the gesture ends.
  - While a gesture runs on the preview, the page neither scrolls nor zooms, so its scroll position and zoom scale stay unchanged.
  - Checks look only at the direction of each change and its range, never at its size per pixel, wheel step or pinch.
  - All of this, keys included, works the same under reduced motion.

**Forge**

- **Drawing plane by pointer and touch.** Every pointer or touch position is read in CSS pixels from the plane element's top-left corner. The device pixel density never changes where a point lands: a drag from the middle of the square to the middle of its top edge draws a stroke from the centre straight up to the top edge at every density.
  - Pointer or touch down starts a stroke with its first point.
  - Moving records a new point only once the pointer is at least 2 centimetres on the plane from the stroke's last point. Points beyond the plane's edge are not recorded, and a stroke stops taking points at 200.
  - Pointer up commits the stroke.
  - A second finger touching down during a touch stroke discards that stroke without committing it.
- **Drawing plane by keyboard**, with the plane focused:
  - A visible cursor sits at `data-cursor-x`, `data-cursor-y`, which are 0.00 and 0.00 when the forge opens.
  - Up moves the cursor toward the top of the square and raises `data-cursor-y`. Down lowers it. Right moves the cursor toward the right and raises `data-cursor-x`, and Left lowers it. Each press moves 5 centimetres, stopping at −1.00 and 1.00 on each axis.
  - Space adds a point at the cursor under the same 2-centimetre rule, so pressing Space twice without moving adds one point.
  - Enter commits the stroke in progress, and Escape discards it.
  - `data-stroke-points` counts the points of the stroke in progress, and `data-strokes` counts the committed strokes.

  For example, at thickness 0.04 the keys Space, Up four times, Space, Space, Enter give stroke points 1, then 2, still 2 after the repeated Space, then 1 committed stroke from (0.00, 0.00) to (0.00, 0.20), with `data-cursor-y` at `0.20`.
- **Drawing ranges.** The thickness slider runs from 0.01 to 0.08 metres in steps of 0.01 and starts at 0.04, so the form never produces an out-of-range point or thickness. The grip marker sits on the first point of the first stroke.
- **Committing and limits in the form.**
  - A stroke with fewer than 2 points is not committed. It is discarded, and the stroke-shape message from Feedback states is announced in Notifications.
  - Strokes beyond the limits can still be committed, so the player sees what went over:
    - when a commit takes the drawing from 24 to 25 strokes, the "Too many strokes" marker appears beside the stats and the stroke-count message is announced in Notifications;
    - when a commit takes the vertex count above 12,000, the meter shows its over-limit marker and the vertex message is announced in Notifications;
    - each message is announced once per crossing;
    - each marker disappears as soon as an undo or clear brings the drawing back within the limit.
  - Undo stroke removes the last committed stroke, and Clear plane removes all of them.
  - Forge is disabled while the drawing has no stroke or is over a limit.
- **Live stats and drawing revisions.**
  - The forge keeps a drawing revision that starts at 0 and rises by 1 on every commit, Undo stroke and Clear plane.
  - Each of these sends the whole drawing with its revision for a server preview.
  - An answer is applied only when its revision is the newest the page has sent, and older answers are dropped whenever they arrive. So the stats, meter, markers and the Forge stats announcement always describe the newest drawing.
  - The newest drawing's values appear in place within half a second of the change, with no navigation.
  - With no strokes (when the forge opens, after Clear plane, or after undoing the last stroke), the region shows `0.00` for reach, weight and swing speed, the meter reads 0 of 12,000, and the announcement uses those values.
- **Forge.** Pressing Forge sends the save and shows the pending copy on the button.
  - The lift's flight starts when the server answers 201, and it ends on the hero's right hand wherever the current right arm raise puts it.
  - If the save fails, nothing flies, the drawing stays, and the error is announced.
  - After `socketed` the plane stays hidden. Clear plane brings it back empty, at yaw 0 and fully visible, with the lift `idle`, and the weapon stays equipped.

**Armoury and models**

- **Armoury.**
  - Equip equips that weapon on the equipped hero.
  - Delete shows the pending copy. On 204 the card leaves the list in place with no reload, and the weapon-deleted copy is announced. Focus moves to the next card's Equip, or to the previous card's Equip when the deleted card was last. If no card is left, the empty-armoury heading appears and takes focus.
- **Models page during an upload.**
  - Status events for the creator's models re-render the "My models" list and the "Upload report" region in place.
  - The selected model stays selected and the report region stays open. The report heading changes from the in-progress heading to the verdict heading.
  - The focused element is never replaced, so keyboard focus stays on the same element through every re-render.
  - When the realtime connection opens or reopens, the page reads each model it shows from the server and brings the list and report up to date. A stage it has already announced is not announced again.
- **Delete model.** Pressing Delete model shows the pending copy and ignores further presses until the answer, keeping keyboard focus.
  - On 204 the item leaves the list, the model-deleted copy is announced, focus moves to Upload model, and the storage banner disappears.
  - On 503 the delete-outage banner appears. The item stays listed with `aria-current="true"`, its report stays open, its status is unchanged, and focus stays on Delete model.
- **Storage banner.** The Models page draws the storage alert banner from the account's stored storage notice on every load, so it survives reloads and new sign-ins. The banner's copy follows the kind of the last failure.

**Party**

- **Join party.**
  - Join party shows the pending copy and is disabled until the server answers. Until a 200 arrives, the page shows no membership, does not navigate and adds no joined line.
  - On 200 the page moves to `/party/<party id>`.
  - On 409 `party_full` the page stays on `/invite/<token>`, announces the party-full copy, and enables Join party again.
- **Ready check.**
  - When a check starts, every member's screen opens the "Ready check" dialog with focus on Ready. Tab wraps inside it, and Enter or Space answers.
  - After answering, both buttons are disabled, and the dialog stays open until the check ends.
  - Escape closes the dialog without answering. The member counts as not ready only if the check ends before they answer.
  - While the check runs, the leader reopens the dialog with Start ready check, which does not start a new check while one runs, and every other member reopens it with Open ready check. The reopened dialog shows the running check and still accepts an answer.
  - A member who loads or reloads the party lobby while a check runs sees the dialog open by itself with the server's current time left. Focus goes to Ready if they have not answered. If they have, both buttons are disabled.
  - Time left changes only when a new value arrives from the server, never from the device clock, which may be hours wrong.
  - When the dialog closes, focus returns to the element that had focus before it opened. If that element is gone, focus goes to Start ready check for the leader and Open ready check for everyone else.
- **Party members list.** Each item updates from the latest party state the server sends, never from the device clock. The presence word and the seat-held line therefore change only when a new party state arrives.

**Chat**

- **Sending.**
  - Enter in the Message field sends. Shift+Enter is ignored, because messages are one line.
  - The Message counter updates on every keystroke, paste and deletion, and the field never cuts off what the player types or pastes. Text outside the limit stays in the field, the counter turns brick red, and the limit copy appears in Chat status. Send then sends nothing.
- **Drawer.** Below 768 pixels, Open chat opens the "Chat" drawer from the right with focus on Message. Tab wraps inside it. Escape or Close chat closes it and returns focus to Open chat. While the drawer is closed, nothing in it can be focused, clicked or reached by assistive technology, and its Messages log is not in the accessibility tree.
- **Messages.** A message appears in Messages once, and only from the server's answer or the chat stream.
- **Sending while offline.** If a send gets no answer because the network is down, the text stays in the field and Send shows the pending copy. The send is retried with the same client message ID once the server is reachable again, and the field clears when the server stores the message.
- **Across a reconnect.** When a connection drops and comes back, the drawer keeps its open or closed state and the text typed in Message.

**Realtime and play**

- **Reconnecting.**
  - When the realtime socket closes, or the browser reports that it is back online, the page opens a new connection by itself at once, then retries at least every 2 seconds until one opens.
  - On open, it sends `hello` with the last seq it showed for each stream, then a heartbeat, then `join_session` again when on a play page.
  - After that it resends every intent that has no ack yet, each with its original intent ID.
  - Any of the account's open tabs can do this.
- **Session members roster.** The play page's "Session members" list follows the latest snapshot: one item per member in the snapshot, with the seat-held line shown while that member's `status` is `dropped`, using their `grace_remaining_seconds`. A member removed from the snapshot leaves the list.
- **Play controls.** A click or tap on the ground sends a move intent to that point. W, A, S and D or the arrow keys send a move intent 2 metres in that direction every quarter second while held. Space swings the equipped weapon.
- **Emotes.**
  - E opens the "Emotes" menu with focus on its first item. Arrow keys move, Enter sends, and Escape closes the menu and returns focus.
  - Keys 1 to 6 send Wave, Cheer, Bow, Laugh, Point and Shrug directly wherever focus is in the play page except the Message field, including when focus is on a button.
  - A sent emote shows above the hero for 2 seconds and adds a line to Session events.
- **Session end on screen.**
  - When the session stream reports completion, or `join_session` is answered with completion, every member's page moves to that chapter's complete route within 2 seconds, including members who were mid-reconnect.
  - When `join_session` is refused because the seat was released or the session ended, the page announces the matching copy and moves to the party lobby, or to `/stories` when the player is in no party.

**Everywhere**

- **Language picker.** Choosing an option saves it at once and re-renders the page in that language.
- **Focus.** Every focusable control shows a clearly visible cobalt ring, at least two pixels thick, that contrasts with both the paper and the scene.

### Visual design (DP-58)

- **Colour roles.**
  - A warm off-white paper ground with a faint, still, procedural grain.
  - Graphite near-black for text, outlines and the stroke outlines of every 3D part.
  - A strong cobalt blue for primary actions, links, selection and focus.
  - A marker yellow used like a highlighter behind selected swatches, the active tab and the meter fill.
  - A brick red only for alerts, over-limit states, over-limit counters and failed rules.

  Passed rules use graphite with a cobalt tick, so colour is never the only signal.
- **Type.** Headings, tab labels and stat numerals use Fredoka, a rounded, friendly display face. Body text and controls use Nunito, an open, rounded sans. Japanese uses Noto Sans JP throughout. Each heading level is about a quarter larger than the level below it, and body text is comfortable to read at arm's length on a phone.
- **Density.** Comfortable, with generous spacing inside cards. Every tap target is at least 44 by 44 pixels.
- **Composition.**
  - The scene is always visible behind the paper layer.
  - Desktop tabs look like strips torn from a sketchbook.
  - The inspector looks like a ruled notebook card with a pencil margin line.
  - Every 3D part (hero, weapon, level props) carries an even graphite outline around its silhouette, so the scene reads as an inked drawing.
- **Icons.** One consistent line-icon set, with graphite strokes matching the weight of the text.
- **Contrast.** All text and controls meet WCAG 2.2 AA against the paper and against cards over the scene.

### Motion and effects (DP-17, DP-22, DP-57, DP-67)

Every motion carries meaning: entering, leaving, a change of state, progress, or feedback on a press. Unnamed decorative loops are not allowed, and the paper grain never moves. Each scene motion below shows in the scene state attributes.

- **Button press and menu settle.** A pressed button dips slightly within about a seventh of a second. Menus, sheets and the drawer arrive with a small springy settle that overshoots by no more than six pixels and comes to rest within 0.4 seconds.
- **Hangar idle.** The camera turns slowly around the equipped hero, one full turn every 30 to 40 seconds. During the turn the orbit angle keeps rising and wraps from 359 to 0, and the turntable reads on. Dragging takes over the camera and turns the turntable off, and the turn resumes 3 seconds after the last drag.
- **Builder camera.** Choosing a parts section moves the camera toward that part over 0.3 to 0.5 seconds. During the move, camera-moving reads true and the camera focus names the section. Part, pose and material changes appear on the hero within a tenth of a second.
- **Chapter flythrough.** On entering a play page, the camera glides over the level from the gate to the spawn point over 3 to 5 seconds, with the flythrough reading playing. Then it hands control to the player and reads done. Skip or Escape ends it at once.
- **Ink-to-steel lift (signature).** The player turns flat strokes into a solid weapon and watches it go into their posed hero's hand, seeing the grip point, reach and weight before it reaches the armoury.
  1. When a stroke is committed, its flat line on the plane inflates into a round tube. The lift reads inflating for 0.25 to 0.4 seconds, then idle. During inflating the tube's radius only grows, from nothing to the chosen thickness. It grows fast at first and settles gently, and the graphite outline thickens with it.
  2. Over the same span, the reach, weight and swing-speed numerals count from their old values to the server's values for the newest drawing, staying in the active locale's number format throughout.
  3. When the server confirms Forge, the lift reads flying for 0.4 to 0.6 seconds. In that time the plane only turns further from the camera, from 0 to −35 degrees around its vertical axis, and only fades, from fully visible to invisible.
  4. Over the same span, the weapon flies along a curved arc from the plane's centre to the hero's right hand, wherever the right arm raise puts it. The arc rises above the straight line between them, so the arc height is above zero at mid-flight. The weapon arrives with its grip marker exactly on the hand.
  5. The lift then reads catching for 0.5 to 0.7 seconds while the hero plays a catch-and-hold pose. Finally it reads socketed:
     - the grip gap is zero;
     - the weapon's graphite ink is drawn at the hand's published screen position;
     - the equipped weapon on the plane's state is the ID the server returned, which is also the entry the inspector shows.
- **Reduced motion** (the player's system asks for reduced motion):
  - The hangar does not turn and the turntable stays off. Dragging still orbits.
  - The flythrough is replaced by a still overview, shown for at most one second with the flythrough reading still, before control is handed over. Skip still works.
  - Builder camera moves cut straight to the new view, with no moving phase.
  - Buttons and menus appear with no spring.
  - In the lift, the tube appears at full radius at once and the lift stays idle. The numerals switch straight to their new values, and Forge stats still announces them.
  - On a confirmed Forge the plane does not turn. Plane and weapon reach the socketed state through one crossfade of 0.1 to 0.15 seconds: the lift reads crossfading, then socketed, and never inflating, flying or catching. No pose plays.
  - The grip gap, the ink at the hand and the equipped weapon end the same as with full motion.
- **Without WebGL.** The hangar, builder and forge show a still graphite drawing of the default stick figure with the no-WebGL notice. Every control keeps working, saves the same data and updates the same scene state attributes. The play page shows a flat top-down drawing of the layout, with heroes as labelled dots, and accepts the same controls.

### Feedback states (DP-04, DP-08, DP-09, DP-14, DP-15, DP-20, DP-21, DP-29, DP-34, DP-40, DP-47, DP-56, DP-69, DP-70, DP-73, DP-78)

Every async action has four states:
- **Pending.** The triggering control is announced as disabled, ignores presses, keeps keyboard focus if it had it, and shows the pending copy.
- **Success.** The success copy is announced in the named polite region. Success copy is shown only after the server confirms.
- **Field error.** The message appears under its field and the field is marked invalid. An error summary at the top of the form links to each invalid field. A message for a field the screen has no input for appears in the region the table names.
- **Outage.** The banner appears as an alert.

Every message the API returns in `error.message` or `error.fields` is the matching copy below, in the request's resolved language.

Each region keeps its last message until a newer message for that region replaces it. No timer clears it. The Upload status region shows an upload's stages strictly in this order:
1. the pending copy;
2. stored;
3. validating;
4. the verdict.

Each stage replaces the one before it with no blank text in between, and each is announced exactly once. A stage the page never saw, because the verdict arrived first, may be skipped, but the last copy is always the verdict.

| Situation | Region | English | 日本語 | Español |
|---|---|---|---|---|
| Pending (any save, send, join, delete or sign-in) | on the control | `Working...` | `処理中...` | `Procesando...` |
| Pending upload | Upload status | `Uploading...` | `アップロード中...` | `Subiendo...` |
| Hero saved | Notifications | `Saved to slot <n>.` | `スロット<n>に保存しました。` | `Guardado en la ranura <n>.` |
| Stale slot (412) | Notifications | `This slot changed in another tab. Reload it before saving.` | `このスロットは別のタブで変更されました。保存する前に再読み込みしてください。` | `Esta ranura cambió en otra pestaña. Recárgala antes de guardar.` |
| Weapon forged | Notifications | `Weapon saved to the armoury.` | `武器を武器庫に保存しました。` | `Arma guardada en la armería.` |
| Weapon deleted | Notifications | `Weapon deleted.` | `武器を削除しました。` | `Arma eliminada.` |
| Forge stats announcement | Forge stats | `Reach <reach> m, weight <weight> kg, swing speed <swing> per second, <used> of <limit> vertices.` | `リーチ<reach> m、重さ<weight> kg、振りの速さ毎秒<swing>回、頂点<used>/<limit>。` | `Alcance <reach> m, peso <weight> kg, velocidad de golpe <swing> por segundo, <used> de <limit> vértices.` |
| Upload stored | Upload status | `Stored. Waiting to validate.` | `保存しました。検証を待っています。` | `Guardado. Esperando la validación.` |
| Upload validating | Upload status | `Validating against rulebook <version>.` | `ルールブック<version>で検証中です。` | `Validando con el reglamento <version>.` |
| Upload accepted | Upload status | `Accepted. You can equip this model.` | `承認されました。このモデルを装備できます。` | `Aceptado. Ya puedes equipar este modelo.` |
| Upload rejected | Upload status | `Rejected: 1 rule failed.` / `Rejected: <n> rules failed.` | `不合格: <n>件のルールに違反しています。` | `Rechazado: 1 regla no superada.` / `Rechazado: <n> reglas no superadas.` |
| Model equipped | Notifications | `Model equipped.` | `モデルを装備しました。` | `Modelo equipado.` |
| Model deleted | Notifications | `Model deleted.` | `モデルを削除しました。` | `Modelo eliminado.` |
| Storage outage on upload | alert banner on Models | `Model storage is unavailable. Your file was not saved. Try again in a few minutes.` | `モデルの保存先に接続できません。ファイルは保存されていません。数分後にもう一度お試しください。` | `El almacenamiento de modelos no está disponible. Tu archivo no se ha guardado. Inténtalo de nuevo en unos minutos.` |
| Storage outage on delete | alert banner on Models | `Model storage is unavailable. Your model was not deleted. Try again in a few minutes.` | `モデルの保存先に接続できません。モデルは削除されていません。数分後にもう一度お試しください。` | `El almacenamiento de modelos no está disponible. Tu modelo no se ha eliminado. Inténtalo de nuevo en unos minutos.` |
| Verification sent | Notifications | `Verification email sent to <email>.` | `<email> に確認メールを送信しました。` | `Correo de verificación enviado a <email>.` |
| Verification not sent (mail outage) | alert banner on the hangar | `We couldn't send your verification email. Resend when you're ready.` | `確認メールを送信できませんでした。準備ができたら再送信してください。` | `No pudimos enviar tu correo de verificación. Reenvíalo cuando quieras.` |
| Reset requested | Notifications | `If that email has an account, a reset link is on its way.` | `そのメールアドレスのアカウントがあれば、再設定リンクを送信しました。` | `Si ese correo tiene una cuenta, te enviamos un enlace para restablecerla.` |
| Reset email not sent (mail outage) | alert banner | `We couldn't send the reset email. Try again in a few minutes.` | `再設定メールを送信できませんでした。数分後にもう一度お試しください。` | `No pudimos enviar el correo para restablecer. Inténtalo de nuevo en unos minutos.` |
| Email confirmed | page heading | `Email confirmed.` | `メールアドレスを確認しました。` | `Correo confirmado.` |
| Password changed | Notifications | `Password changed. Sign in with your new password.` | `パスワードを変更しました。新しいパスワードでサインインしてください。` | `Contraseña cambiada. Inicia sesión con la nueva.` |
| Link expired (410 `link_expired`) | page heading | `This link has expired. Request a new one.` | `このリンクは期限切れです。新しいリンクをリクエストしてください。` | `Este enlace ha caducado. Solicita uno nuevo.` |
| Link already used (410 `link_used`) | page heading | `This link has already been used.` | `このリンクはすでに使用されています。` | `Este enlace ya se ha usado.` |
| Link replaced (410 `link_replaced`) | page heading | `A newer link was sent. Use the link in the latest email.` | `新しいリンクが送信されています。最新のメールのリンクを使ってください。` | `Se envió un enlace más reciente. Usa el enlace del último correo.` |
| Sign in required (401) | Notifications | `Sign in to continue.` | `続けるにはサインインしてください。` | `Inicia sesión para continuar.` |
| Wrong credentials | form summary | `Email or password is incorrect.` | `メールアドレスまたはパスワードが正しくありません。` | `El correo o la contraseña no son correctos.` |
| Email taken | field | `An account with this email already exists.` | `このメールアドレスのアカウントはすでに存在します。` | `Ya existe una cuenta con este correo.` |
| Email malformed | field | `Enter a valid email address.` | `正しいメールアドレスを入力してください。` | `Escribe un correo válido.` |
| Display name limit | field | `Display name must be 3 to 20 characters.` | `表示名は3〜20文字にしてください。` | `El nombre visible debe tener entre 3 y 20 caracteres.` |
| Display name taken | field | `That display name is taken.` | `この表示名は使われています。` | `Ese nombre visible ya está en uso.` |
| Hero name limit | field | `Hero name must be 3 to 20 characters.` | `ヒーロー名は3〜20文字にしてください。` | `El nombre del héroe debe tener entre 3 y 20 caracteres.` |
| Password limit | field | `Password must be 10 to 128 characters.` | `パスワードは10〜128文字にしてください。` | `La contraseña debe tener entre 10 y 128 caracteres.` |
| Hero pose or proportions invalid | Notifications | `This hero's pose or proportions are out of range.` | `ヒーローのポーズまたは体型が範囲外です。` | `La postura o las proporciones del héroe están fuera de rango.` |
| Chat message limit | Chat status | `Messages must be 1 to 280 characters.` | `メッセージは1〜280文字にしてください。` | `Los mensajes deben tener entre 1 y 280 caracteres.` |
| Chat cooldown (429) | Chat status | `Slow down: you can send again in <seconds> s.` | `送信が速すぎます。<seconds>秒後に再送信できます。` | `Más despacio: podrás enviar de nuevo en <seconds> s.` |
| Stroke count | Notifications | `A weapon needs 1 to 24 strokes.` | `武器の線は1〜24本にしてください。` | `Un arma necesita entre 1 y 24 trazos.` |
| Vertex limit | Notifications | `A weapon can have at most 12,000 vertices.` | `武器の頂点数は最大12,000です。` | `Un arma puede tener como máximo 12.000 vértices.` |
| Stroke shape | Notifications | `Each stroke needs 2 to 200 points inside the plane.` | `各線には描画面内の点が2〜200個必要です。` | `Cada trazo necesita entre 2 y 200 puntos dentro del plano.` |
| Stroke thickness | Notifications | `Stroke thickness must be 0.01 to 0.08 m.` | `線の太さは0.01〜0.08 mにしてください。` | `El grosor del trazo debe estar entre 0,01 y 0,08 m.` |
| Upload too large (413) | Upload status | `Uploads can be at most 15 MiB.` | `アップロードできるのは最大15 MiBです。` | `Las subidas pueden ocupar como máximo 15 MiB.` |
| Upload quota (413) | Upload status | `You've used your 60 MiB of model storage. Delete a model to upload another.` | `モデルの保存容量60 MiBを使い切りました。別のモデルをアップロードするには、モデルを削除してください。` | `Has usado tus 60 MiB de almacenamiento de modelos. Elimina un modelo para subir otro.` |
| Wrong type or not glTF (415) | Upload status | `This file is not a glTF binary (.glb).` | `このファイルはglTFバイナリ（.glb）ではありません。` | `Este archivo no es un binario glTF (.glb).` |
| Model not accepted (409) | Notifications | `Only accepted models can be equipped.` | `装備できるのは承認済みのモデルだけです。` | `Solo se pueden equipar modelos aceptados.` |
| Chapter locked | Notifications | `Finish the previous chapter first.` | `先に前の章をクリアしてください。` | `Termina antes el capítulo anterior.` |
| Chapter number invalid | Notifications | `That chapter doesn't exist in this story.` | `このストーリーにその章はありません。` | `Ese capítulo no existe en esta historia.` |
| Party full (409) | Notifications | `This party is full (4 of 4).` | `このパーティーは満員です（4/4）。` | `Este grupo está completo (4 de 4).` |
| Already in a party | Notifications | `You're already in a party.` | `すでにパーティーに参加しています。` | `Ya estás en un grupo.` |
| Invite closed (410) | Notifications | `This invite is no longer open.` | `この招待は無効になりました。` | `Esta invitación ya no está disponible.` |
| Not a friend | Notifications | `You can only invite friends.` | `招待できるのはフレンドだけです。` | `Solo puedes invitar a tus amigos.` |
| Not leader (403) | Notifications | `Only the party leader can do that.` | `この操作はリーダーだけができます。` | `Solo el líder del grupo puede hacer eso.` |
| Email unverified (403) | Notifications | `Confirm your email to play with friends.` | `フレンドと遊ぶには、メールアドレスを確認してください。` | `Confirma tu correo para jugar con amigos.` |
| Too few for ready check | Notifications | `A ready check needs at least 2 members.` | `準備確認には2人以上のメンバーが必要です。` | `La comprobación necesita al menos 2 miembros.` |
| Seat released on rejoin | Notifications | `Your seat in this session was released.` | `このセッションのあなたの席は解放されました。` | `Tu puesto en esta partida se liberó.` |
| Session ended on rejoin | Notifications | `This session has ended.` | `このセッションは終了しました。` | `Esta partida ha terminado.` |
| Friend request sent | Notifications | `Friend request sent to <name>.` | `<name>さんにフレンド申請を送りました。` | `Solicitud de amistad enviada a <name>.` |
| Friends now | Notifications | `You and <name> are now friends.` | `<name>さんとフレンドになりました。` | `Ahora tú y <name> sois amigos.` |
| No such player | field | `No player has that display name.` | `その表示名のプレイヤーはいません。` | `Ningún jugador tiene ese nombre visible.` |
| Already friends | Notifications | `You're already friends.` | `すでにフレンドです。` | `Ya sois amigos.` |
| Request already waiting | Notifications | `A friend request between you is already waiting.` | `お二人の間のフレンド申請はすでに保留中です。` | `Ya hay una solicitud de amistad pendiente entre vosotros.` |
| Self request | field | `You can't add yourself.` | `自分自身は追加できません。` | `No puedes añadirte a ti mismo.` |
| Any other failure (500) | Notifications | `Something went wrong. Try again.` | `問題が発生しました。もう一度お試しください。` | `Algo salió mal. Inténtalo de nuevo.` |

Numbers in copy (`<reach>`, `<weight>`, `<swing>`, `<used>`, `<limit>`, a numeric `<measured>`, `<collected>`, `<n>` and the R10 components) use the standard number format of `en-US`, `ja-JP` or `es-ES`, exactly as browsers format them. Stats always have two decimals, R10 components four, and counts none. For example, in `es-ES` 12000 reads `12.000`, 1600 reads `1600`, and a reach of 0.2 reads `0,20`.

The other placeholders:
- `<seconds>` is a whole number.
- `<email>` is the account's email address.
- `<version>` is the rulebook version the upload is judged under.

## Backend

### API (DP-02, DP-05, DP-07, DP-15, DP-19, DP-21, DP-25, DP-27, DP-30, DP-32, DP-36, DP-39, DP-46, DP-51, DP-54, DP-55, DP-59, DP-61, DP-64, DP-67, DP-68, DP-71, DP-72, DP-74, DP-75)

All endpoints sit under `/api`. JSON bodies use `Content-Type: application/json` and may be up to 1,000,000 bytes, with exactly 1,000,000 allowed. Signed-in requests carry the `lw_session` cookie, which is HttpOnly and SameSite=Lax and is set by sign-up and sign-in. All IDs are UUIDs unless stated otherwise.

**Numbers on the wire.** Every count and every value named `seq`, `tick`, `number`, `deadline_at`, `remaining_seconds`, `grace_remaining_seconds`, `size_bytes`, `slot`, `revision`, `chapter`, `failed_count`, `vertices`, `strokes` (as a count) and `drawing_revision` is a JSON integer in every REST and realtime message, never a string. Stats, positions, health, proportions and pose are JSON numbers. A request that sends any of these as a string answers 422 on that field. `after_seq` is a decimal integer of 0 or more. Any other value answers 422 `fields.after_seq`.

**Error shape** (every error): `{"error":{"code":"<code>","message":"<localised message>"}}`. A 422 adds `"fields":{"<field>":"<localised message>"}`. Messages use the locale resolved by the rule in Business rules.

**Error precedence** (applies to every endpoint):
1. 401 `unauthenticated` for a missing or expired session.
2. 404 `not_found` for any unknown ID, any ID owned by another account (IDs inside request bodies included), and any session, party or member route the caller is not currently a member of.
3. 403 `forbidden` codes (`not_leader`, `email_unverified`, `cross_origin`).
4. An idempotent replay returns its stored status and body exactly as first sent, before any later check.
5. 429 `rate_limited`.
6. 409, 410 and 412 state conflicts.
7. 413, 415 and 422 validation.

Endpoint rows list only their own extra errors and any stated exception to this order.

**Auth and account**
- `GET /api/health` → `200 {"status":"ok"}`. Needs no session and answers whether or not mail or storage is reachable.
- `PUT /api/locale` `{"locale":"en"|"ja"|"es"}` → `204`. Sets the `lw_locale` cookie for one year. When signed in, it also saves the account's locale. 422 `fields.locale`.
- `POST /api/auth/signup` `{"email","password","display_name","locale"}` → `201 {"account":Account,"verification_email":"sent"|"not_sent"}`, with the session cookie, and `lw_locale` set to the account's locale. The top-level `verification_email` equals `account.verification_email`. Errors: 409 `email_taken`, 409 `display_name_taken`, 422 with `fields.email`, `fields.password`, `fields.display_name`, `fields.locale`.
- `POST /api/auth/signin` `{"email","password"}` → `200 {"account":Account}`, with the session cookie, and `lw_locale` rewritten to the account's locale. 401 `invalid_credentials`.
- `POST /api/auth/signout` → `204`. The `lw_locale` cookie stays.
- `POST /api/auth/verify` `{"token"}` → `200 {"account":Account}`. Errors: 404 for an unknown token, 410 `link_used`, 410 `link_replaced`, 410 `link_expired`.
- `POST /api/auth/verification/resend` → `202 {"verification_email":"sent"}`. Errors: 409 `already_verified`, 503 `mail_unavailable`.
- `POST /api/auth/password-reset` `{"email"}` → `202 {}` for any well-formed address, whether or not it has an account. Errors: 503 `mail_unavailable`, 422 `fields.email`.
- `POST /api/auth/password-reset/confirm` `{"token","password"}` → `200 {}`. Ends every session of that account. Errors: 404, 410 `link_used`, 410 `link_replaced`, 410 `link_expired`, 422 `fields.password`.
- `GET /api/me` → `200 {"account":Account,"equipped_character_id":<id>|null}`.
- `PATCH /api/me` `{"display_name"?}` → `200 {"account":Account}`. Errors: 409 `display_name_taken`, 422.
- `Account` = `{"id","email","display_name","locale","email_verified":bool,"verification_email":"sent"|"not_sent","storage_notice":null|"upload_unavailable"|"delete_unavailable"}`.

**Heroes (characters)**
- `GET /api/characters` → `200 {"characters":[Character]}`, ordered by slot.
- `GET /api/characters/<id>` → `200 {"character":Character}`.
- `PUT /api/characters/slots/<slot>` (slot 1, 2 or 3), body `{"revision":<int>|null,"name","parts","proportions","pose":{"right_arm_raise":<number>},"material","accessories","model_id":<id>|null,"weapon_id":<id>|null}`.
  - Answers `201 {"character":Character}` when the slot was empty.
  - Answers `200 {"character":Character}` when it replaces the slot's hero, keeping the same ID with revision + 1.
  - Errors:
    - 412 `stale_revision` when `revision` is not the slot's current revision (`null` means an empty slot);
    - 409 `model_not_accepted`;
    - 422 with `fields.name`, `fields.proportions`, `fields.pose`, `fields.parts`, `fields.material` or `fields.accessories` (the pose and proportion message is the hero pose copy);
    - 404 for a slot outside 1 to 3.
- `POST /api/characters/<id>/equip` → `200 {"character":Character}`. That hero becomes the account's equipped hero.
- `DELETE /api/characters/<id>` → `204`. If it was the equipped hero, the hero in the lowest remaining slot becomes equipped.
- `Character` = `{"id","slot","revision","name","parts":{"head":"round"|"square"|"triangle","torso":"stick"|"barrel"|"kite","arms":"thin"|"thick","legs":"thin"|"thick"|"spring"},"proportions":{"head_size","neck_length","spine_length","upper_arm_length","forearm_length","thigh_length","shin_length"},"pose":{"right_arm_raise"},"material":"graphite"|"cobalt"|"marker"|"chalk"|"brick"|"moss","accessories":{"head":"none"|"paper_crown"|"beanie","back":"none"|"scarf"|"satchel","left_hand":"none"|"lantern"|"shield"},"model_id","weapon_id","equipped":bool}`.
  - Each proportion is a JSON number from 0.5 to 1.5, both ends allowed, in steps of 0.05. A string such as `"1,25"` answers 422.
  - `pose.right_arm_raise` is the same angle the builder's Right arm raise slider shows, in radians: a JSON number from −3.1416 to 3.1416, both ends allowed. It is stored and returned rounded half up to 4 decimals, with halves moving away from zero. It defaults to 0 when the body has no `pose`. For example, 45° is stored as `0.7854` and −90° as `-1.5708`.

**Weapons**
- `POST /api/weapons/preview` `{"strokes":[Stroke],"drawing_revision"?:<int>}` (0 or more strokes) → `200 {"drawing_revision":<int>|null,"stats":Stats,"strokes":<count>,"vertices":<count>,"within_limits":bool,"over":["strokes"|"vertices"]}`. `drawing_revision` echoes the request's value, or is null when the request had none. The empty-drawing and over-limit answers and the 422 causes are in Business rules.
- `POST /api/weapons` `{"character_id","strokes":[Stroke]}` → `201 {"weapon":Weapon,"character":Character}`. Saves the weapon to the armoury and equips it on that hero. 422 with the fields Business rules lists.
- `GET /api/weapons` → `200 {"weapons":[Weapon]}`, newest first.
- `GET /api/weapons/<id>` → `200 {"weapon":Weapon}`.
- `DELETE /api/weapons/<id>` → `204`. What a delete changes everywhere is in Business rules.
- `Stroke` = `{"thickness":<metres>,"points":[[x,y],...]}`. Each point is in metres from the drawing plane's centre, with x growing to the right and y growing upward.
- `Stats` = `{"reach_m","weight_kg","swing_per_s"}`, numbers with two decimals.
- `Weapon` = `{"id","number","strokes":[Stroke],"stats":Stats,"vertices","equipped_on":[<character id>]}`.

**Models**
- `POST /api/models` takes the file as the raw request body. Headers: `Content-Type: model/gltf-binary` or `application/octet-stream`, and `X-Filename: <percent-encoded UTF-8 name>`. Answers `201 {"model":Model}` with status `stored`. Errors: 415 `unsupported_type` (any other content type), 415 `not_gltf` (the first four bytes are not ASCII `glTF`), 413 `too_large`, 413 `quota_exceeded`, 503 `storage_unavailable`.
- `GET /api/models` → `200 {"models":[Model]}`, newest first. Lists only models in `stored`, `validating`, `accepted`, `equipped` or `rejected`.
- `GET /api/models/<id>` → `200 {"model":Model}`.
- `GET /api/models/<id>/file` → `200`, the original bytes as `model/gltf-binary`. 503 `storage_unavailable`.
- `GET /api/models/<id>/thumbnail` → `200 image/png` for accepted and equipped models only, otherwise 404.
- `DELETE /api/models/<id>` → `204`. 503 `storage_unavailable`. Its all-or-nothing behaviour is in Services.
- `GET /api/rulebook` → `200 {"version":"2026.11-r1","validator":"2.0.0-dev.3.10","rules":[{"id":"R01","title":"<localised>","limit":<number>|null}]}`, R01 to R10, with each rule's limit as the rulebook in Business rules lists.
- `Model` = `{"id","filename","size_bytes","sha256","status":"stored"|"validating"|"accepted"|"equipped"|"rejected","rulebook_version":<string>|null,"report":Report|null,"created_at"}`.
- `Report` = `{"rulebook_version","failed_count","rules":[{"id","status":"pass"|"fail"|"skipped","measured":<number|string|[number,number,number,number]|null>,"limit":<number|null>}]}`, with one entry per rule of its rulebook, R01 to R10 in order.

**Stories and sessions**
- `GET /api/stories` → `200 {"stories":[{"id","mode":"solo"|"coop","title":"<localised>","chapters":<count>,"progress":Progress|null}]}`. `progress` is the caller's solo progress for the solo story, and the current party's progress for co-op stories.
- `GET /api/stories/<story id>/progress` → `200 {"progress":Progress}`, the caller's solo progress. 409 `wrong_story_mode` for co-op stories.
- `Progress` = `{"unlocked_chapter","completed_chapters":[n],"checkpoint":{"chapter","motes":["m1"...]}|null}`.
- `POST /api/stories/<story id>/sessions` `{"chapter":<n>}` → `201 {"session_id","chapter","resumed_from_checkpoint":bool}`.
  - 422 `fields.chapter` for a chapter number the story does not have, such as 0 or 4 for a three-chapter story. This is checked before `chapter_locked`, as an exception to the precedence.
  - 409 `chapter_locked`, 409 `wrong_story_mode`.
- `GET /api/sessions/<id>` (current members only) → `200 {"session":Snapshot}`.
  - `Snapshot` = `{"id","story_id","chapter","mode","status":"running"|"complete","tick","gate_open":bool,"checkpoint_reached":bool,"motes":[{"id","x","z","collected_by":<account id>|null}],"members":[Member]}`.
  - `Member` = `{"account_id","display_name","status":"connected"|"dropped","grace_remaining_seconds":<int>|null,"position":{"x","z"},"health","hero":Character-without-ids,"weapon":{"strokes","stats"}|null,"model_url":"/api/sessions/<id>/members/<account id>/model"|null}`.
  - `hero` carries the member's `pose`. Positions and health are numbers rounded to three decimals.
- `GET /api/sessions/<id>/members/<account id>/model` → `200 model/gltf-binary`, streamed from MinIO, with bytes whose SHA-256 equals the model record's `sha256`.
  - Only current members of that session may fetch it, the model's owner included, and only while the session is `running`.
  - The model must be accepted and equipped on that member's session hero, and the member must still hold their seat. A member who is dropped but still inside their grace still holds it.
  - Errors: 404 in every other case, including after the session completes, after the owner deletes or unequips the model, and after the owner's seat is released; 503 `storage_unavailable`. On a 503, clients draw that member as their stick figure.

**Friends**
- `GET /api/friends` → `200 {"friends":[{"account_id","display_name","presence":"online"|"offline"}],"incoming":[Request],"outgoing":[Request]}`.
- `POST /api/friends/requests` `{"display_name","client_request_id"}` → `201 {"request":Request}`. Errors: 409 `already_friends`, 409 `request_pending`, 409 `idempotency_conflict`, 422 `fields.display_name` (a self request, or no such player).
- `POST /api/friends/requests/<id>/accept` → `200 {"friend":{"account_id","display_name","presence"}}`.
- `POST /api/friends/requests/<id>/decline` → `204`.
- Only the addressee may answer a request. It answers 409 `request_closed` once answered.
- `DELETE /api/friends/<account id>` → `204`.
- `Request` = `{"id","from":{"account_id","display_name"},"to":{"account_id","display_name"},"created_at"}`.

**Parties**
- `POST /api/parties` `{"story_id"}` (co-op stories only) → `201 {"party":Party}`, with the caller as leader. Errors: 409 `already_in_party`, 422 `fields.story_id`.
- `GET /api/parties/<id>` (current members only) → `200 {"party":Party}`.
- `GET /api/parties/current` → `200 {"party":Party|null}`.
- `PATCH /api/parties/<id>` `{"story_id"}` → `200 {"party":Party}`. Leader only, in `forming` only.
- `POST /api/parties/<id>/invites` `{"account_id"}` → `201 {"invite":{"id","token","to"}}`. Leader only, in `forming` only. Errors: 409 `party_full`, 422 `fields.account_id` (not a friend).
- `GET /api/invites` → `200 {"invites":[{"token","party_id","from","story_id","member_count"}]}`, the open invites to the caller.
- `POST /api/invites/<token>/accept` → `200 {"party":Party}`. Errors: 409 `party_full`, 409 `already_in_party`, 409 `wrong_state`, 410 `invite_closed`.
- `POST /api/invites/<token>/decline` → `204`.
- `POST /api/parties/<id>/leave` → `204`.
- `POST /api/parties/<id>/leader` `{"account_id"}` → `200 {"party":Party}`. Leader only. 404 when that account is not a member.
- `POST /api/parties/<id>/ready-check` → `201 {"party":Party}`. Leader only. Errors: 409 `wrong_state`, 409 `not_enough_members`.
- `POST /api/parties/<id>/ready-check/response` `{"ready":bool}` → `200 {"party":Party}`. Errors: 409 `no_ready_check`, 409 `already_answered`.
- `POST /api/parties/<id>/return` → `200 {"party":Party}`. Leader only, in `chapter_complete` only.
- `Party` = `{"id","status":"forming"|"ready_check"|"in_session"|"member_dropped"|"chapter_complete","leader_id","story_id","members":[{"account_id","display_name","joined_at","connection":"connected"|"dropped"|"offline","grace_remaining_seconds":<int>|null}],"ready_check":{"deadline_at":<int>,"remaining_seconds":<int>,"responses":{"<account id>":"ready"|"not_ready"|"pending"}}|null,"session_id":<id>|null,"progress":Progress}`.
  - `connection` and `grace_remaining_seconds` follow the party member connection rule in Business rules.
  - `deadline_at` is the check's end as whole Unix seconds by the server's clock.
  - `progress` is the party's progress for its chosen story, and is the only progress source for co-op stories.

These actions need an email-verified account and answer 403 `email_unverified` for an unverified one: creating a party, inviting, accepting an invite, and sending or accepting friend requests.

**Chat**
- Channels: `lobby` (every signed-in account), `party-<party id>` (party members), `session-<session id>` (current session members).
- `GET /api/chat/<channel>/messages?after_seq=<n>` → `200 {"messages":[Message]}`, up to 100 messages with seq above `<n>`, oldest first.
- `POST /api/chat/<channel>/messages` `{"client_message_id","body"}` → `201 {"message":Message}`.
  - A replay with the same `client_message_id` and body is an idempotent replay. It answers the stored `201` with the stored message and creates nothing.
  - The same ID with a different body answers 409 `idempotency_conflict`.
  - Errors: 429 `rate_limited` with a `Retry-After` header in whole seconds, 422 `fields.body`.
- `Message` = `{"id","seq","kind":"user"|"system","author":{"account_id","display_name"}|null,"body":<user text>|null,"code":<system code>|null,"params":{},"text":"<rendered in the reader's language>","created_at"}`.

**Realtime** runs over a WebSocket at `/api/realtime` on the same origin. Opening it requires the session cookie (401 otherwise), and the Origin rule from Server boundary applies. The server sends WebSocket ping frames and closes silent connections as Connection loss in Business rules states. Standard WebSocket clients, browsers included, answer those pings by themselves.

Client to server:
- `{"type":"hello","resume":{"<stream>":<last seq>}}`.
- `{"type":"heartbeat"}`, sent as soon as the connection opens and every 10 seconds after that.
- `{"type":"join_session","session_id"}`.
- `{"type":"intent","session_id","intent_id","action":"move_to"|"swing"|"emote","x"?,"z"?,"emote"?}`. The emote is one of `wave`, `cheer`, `bow`, `laugh`, `point`, `shrug`.

Server to client:
- `{"type":"event","stream","seq","event_id","event":{"kind",...}}`. These are the only replayable messages.
- `{"type":"state","stream":"party:<id>","party":Party}`. Sent at least once per second while a ready check or a grace countdown runs, after every party change (a member's `connection` changing included), and at once after `hello`.
- `{"type":"snapshot","session":Snapshot}`. Sent at least 10 times per second during a session.
- `{"type":"ack","intent_id","applied":bool,"duplicate":bool,"tick":<n>,"reason":null|"cooldown"|"out_of_bounds"|"no_weapon"}`.
- `{"type":"joined","session_id","tick"}`, the answer to a successful `join_session`.
- `{"type":"join_refused","session_id","event":{"kind":"not_a_member"|"session_ended"|"session_complete","story_id"?,"chapter"?}}`, the answer to a refused one. `story_id` and `chapter` are present for `session_complete`.

State and snapshot messages carry no seq and are never replayed. The latest one always wins.

Streams and their events:
- `me`: friend requests, friendship changes, invites, presence of friends, and `model_status` with `model_id`, `status` and, for a verdict, `failed_count`.
- `chat:<channel>`: chat messages. The event's `seq` is the message's `seq`, and its `event_id` is the message's `id`.
- `party:<id>`: party membership, leader and ready-check changes.
- `session:<id>`: pickups, emotes, damage, checkpoints, the gate, and `session_complete` with `story_id` and `chapter`.

After `hello`, a connection follows `me`, `chat:lobby`, and the current party's `party:<id>` and `chat:party-<id>`. After `join_session` it also follows `session:<id>` and `chat:session-<id>`.

### Business rules (DP-02, DP-04, DP-08, DP-13, DP-15, DP-19, DP-21, DP-25, DP-26, DP-27, DP-28, DP-30, DP-32, DP-33, DP-34, DP-36, DP-37, DP-40, DP-41, DP-42, DP-44, DP-46, DP-47, DP-50, DP-51, DP-52, DP-54, DP-55, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-70, DP-71, DP-72, DP-73, DP-75, DP-76)

**Text limits.**
- Lengths are counted in user-perceived characters (grapheme clusters) after trimming leading and trailing spaces, so an emoji such as 👍🏽 counts as 1. For example, 280 × `👍🏽` is exactly 280 and is allowed in chat.
- Display names and hero names: 3 to 20, both ends allowed. Display names are unique regardless of case.
- Passwords: 10 to 128, not trimmed.
- Chat bodies: 1 to 280.
- An email must contain one `@` with text on both sides and a dot in the domain part.
- The forms count the same way and show the same limit message before sending.

**Locale resolution.** This order is decided in one place and serves page HTML, API messages and system lines:
1. The signed-in account's locale.
2. Otherwise, the `lw_locale` cookie when it holds `en`, `ja` or `es`.
3. Otherwise, the `Accept-Language` entries taken in descending q-value. Ties keep header order and q=0 entries are ignored. The first entry whose primary subtag is `en`, `ja` or `es`, in any case, wins.
4. Otherwise `en`.

Sign-up and sign-in rewrite `lw_locale` to the account's locale, and sign-out leaves it, so signed-out pages keep the account's last locale. Emails always use the account's locale, never the requester's.

For example:
- A signed-out request with no cookie and `Accept-Language: es-MX,es;q=0.9` resolves to `es`.
- `fr-FR,ja;q=0.5,en;q=0.4` resolves to `ja`.
- A reset requested from a Japanese-cookie browser for a Spanish account is announced in Japanese and mailed in Spanish.

**Ownership.** Heroes, weapons, models, model files, thumbnails and solo progress each belong to exactly one account. Any read, equip, preview or delete of another account's record answers 404 `not_found`. So does any reference to one in a body, such as `model_id`, `weapon_id` or `character_id` in a hero or weapon save. Co-op sessions are the only exception, and only as stated for `GET /api/sessions/<id>` and its model route.

**Weapon geometry and stats.** Derived once, on the server, from the validated strokes.
- A forgeable drawing has 1 to 24 strokes. Each stroke has 2 to 200 points with both coordinates from −1.0 to 1.0 metres, and a thickness from 0.01 to 0.08 metres. All ends are allowed.
- Vertex count = 8 × the total number of points. It may be at most 12,000, with 12,000 allowed.
- The grip is the first point of the first stroke.
- `reach_m` = the greatest straight-line distance from the grip to any point.
- `weight_kg` = the sum over every segment of π × (thickness ÷ 2)² × segment length × 2,000.
- `swing_per_s` = 3 ÷ (1 + weight_kg × reach_m ÷ 2), computed from the unrounded weight and reach.
- All three stats are rounded half up to two decimals.

For example:
- A single stroke from (0, 0) to (0, 1) at thickness 0.04 gives reach 1.00, weight 2.51, swing speed 1.33 and 16 vertices.
- A stroke from (0, 0) to (0.2, 0) at thickness 0.04 gives reach 0.20, weight 0.50, swing speed 2.86 and 16 vertices.
- A drawing with no strokes has all three stats at 0.00 and 0 vertices.

Every session member receives the same stats from the server. A preview's `drawing_revision` affects nothing on the server and is only echoed back.

**Weapon numbers and deletion.**
- A weapon's `number` counts up from 1 per account and is never reused. After deleting `Weapon 1` and forging again, the new weapon is `Weapon 2`.
- After `DELETE /api/weapons/<id>` answers 204:
  - `GET /api/weapons/<id>` answers 404 and the weapon is gone from `GET /api/weapons`;
  - every hero that held it has `weapon_id: null`;
  - the hangar no longer shows it;
  - in any running session, the owner's snapshot `weapon` turns null within 1 second, and from then on their next `swing` is acked `no_weapon` on the tick it applies.

**Weapon checks at the API.** Shape and thickness are checked before counts.
- A stroke with fewer than 2 or more than 200 points, or a coordinate outside −1.0 to 1.0: 422 with `fields.strokes` = the stroke-shape message, from both preview and save.
- A thickness outside 0.01 to 0.08: 422 with `fields.thickness` = the stroke-thickness message, from both preview and save.
- Otherwise, preview always answers 200:
  - `within_limits` is true when the drawing has at most 24 strokes and at most 12,000 vertices, so an empty drawing answers `within_limits:true`, `over:[]` and zero stats;
  - `over` lists `strokes` when there are more than 24 strokes and `vertices` when there are more than 12,000 vertices.
- Otherwise, save refuses the drawing whatever the client sends:
  - 422 with `fields.strokes` = the stroke-count message for 0 or more than 24 strokes;
  - 422 with `fields.vertices` = the vertex message for more than 12,000 vertices;
  - both fields when both apply.

**Upload intake.**
1. The content type is checked first.
2. The first four bytes are checked for ASCII `glTF` before anything is stored.
3. The size is counted while the body streams in. As soon as it passes 15,728,640 bytes (15 MiB; exactly 15,728,640 is allowed), the request ends with 413 `too_large`, and nothing is stored or parsed.
4. The account quota is 62,914,560 bytes (60 MiB) across all of its stored originals, rejected ones included. An upload that would take the total above it answers 413 `quota_exceeded`. A deleted model frees its bytes at once.
5. The name from `X-Filename` is cleaned:
   - percent-decode it and keep only the part after the last `/` or `\`;
   - replace every character other than ASCII letters, digits, `.`, `-` and `_` with `_`;
   - strip leading dots and cut it to 64 characters;
   - append `.glb` unless it already ends in `.glb` in any case, and use `model.glb` if nothing is left.

   For example, `../../etc/passwd` becomes `passwd.glb`. The cleaned name is only a label, and storage keys never use it.

**Upload state machine.** The states are `received` (internal, never listed), `stored`, `validating`, `accepted`, `equipped` and `rejected`.
- `received → stored` happens only after MinIO confirms the original object was written. The model record is created at that moment.
  - If the write fails, no record exists and the answer is 503 `storage_unavailable`.
  - If the record cannot be written after the object was stored, the server removes that object before answering 500.
- `stored → validating` starts after the 201 response, and only from `stored`.
- `validating → accepted` or `validating → rejected` is written once, together with the rulebook version and the report, within 30 seconds for any allowed file.
- `accepted → equipped` while at least one hero uses the model, and `equipped → accepted` when none does.
- `rejected` is final for that upload. A fix is a new upload.
- Every status change after `stored` sends one `model_status` event on the owner's `me` stream.
- Equipping a model in any state other than `accepted` or `equipped` answers 409 `model_not_accepted`.
- Models left in `stored` or `validating` by a restart resume validation on the next start.
- A stored verdict, report and rulebook version never change, even after the rulebook version moves on. The report is always re-read from what was stored.

**Rulebook `2026.11-r1`.** Its acceptance rules are judged in order. A `skipped` rule always has `measured` null and `limit` null.

| Rule | Check | Skipped when | `measured` and `limit` when judged | Fails when |
|---|---|---|---|---|
| R01 | The GLB header version is 2, the header's length equals the file size, and the first chunk is JSON | never | `measured` null, `limit` null | any part of the check is untrue |
| R02 | The file's bytes are run through the Khronos glTF-Validator, version 2.0.0-dev.3.10, with its default options and no loader for external resources | R01 failed | `measured` = the number of errors the validator reports (warnings, infos and hints do not count), `limit` 0 | `measured` is above 0 |
| R03 | Every name in `extensionsUsed` and `extensionsRequired` is on the allow list `KHR_materials_unlit`, `KHR_texture_transform`, `KHR_materials_emissive_strength` (mesh compression extensions are not on it) | R01 or R02 failed | `measured` = the number of distinct names outside the allow list, `limit` 0 | `measured` is above 0 |
| R04 | Triangles drawn by the default scene, counted as stated below | R01 or R02 failed | `measured` = the triangle count, `limit` 20000 | `measured` is above 20000 |
| R05 | Exactly one skin, with at most 64 joints | R01 or R02 failed | With other than one skin: `measured` = the skin count, `limit` 1. With one skin: `measured` = its joint count, `limit` 64 | the skin count is not 1, or the joint count is above 64 |
| R06 | The skin's joints include nodes named `hips`, `spine`, `chest`, `neck`, `head`, `leftUpperArm`, `leftLowerArm`, `leftHand`, `rightUpperArm`, `rightLowerArm`, `rightHand`, `leftUpperLeg`, `leftLowerLeg`, `leftFoot`, `rightUpperLeg`, `rightLowerLeg`, `rightFoot` | R01, R02 or R05 failed | `measured` = the missing names in the order listed here, joined by `, `, or the empty string `""` when none is missing; `limit` null | any name is missing |
| R07 | Materials | R01 or R02 failed | `measured` = the material count, `limit` 8 | `measured` is above 8 |
| R08 | Every image is stored in the file's binary chunk; an image given by any `uri` counts as not embedded | R01 or R02 failed | `measured` = the number of images not embedded, `limit` 0 | `measured` is above 0 |
| R09 | Image size | R01, R02 or R08 failed | `measured` = the largest width or height in pixels among the images (0 when there are none), `limit` 2048 | `measured` is above 2048 |
| R10 | The `hips` joint's rest rotation is upright | R01, R02, R05 or R06 failed | `measured` = the hips node's `rotation` in glTF's own order `[x, y, z, w]`, each component rounded half up to 4 decimals (halves away from zero), or `[0, 0, 0, 1]` when the node has no `rotation`; `measured` null when the node is given by a `matrix`; `limit` null | the absolute value of the rounded `w` is below 0.9999, or the node uses a `matrix` |

**R04 triangle count.**
- The default scene is the file's `scene`, or scene 0 when `scene` is absent. A file with no scenes measures 0.
- Walk the default scene's node tree, children included. Every node in it that names a mesh contributes every primitive of that mesh. So a mesh reached through N nodes counts N times, and a mesh that no node in the default scene reaches counts 0.
- Per primitive, take the index count, or the POSITION accessor's count when the primitive has no indices, and count by mode:
  - triangles (the default mode): the count ÷ 3, rounded down;
  - triangle strip and triangle fan: the count − 2, never below 0;
  - points and every line mode: 0.

For example:
- A 10,001-triangle mesh used by two scene nodes measures 20002 and fails.
- The same mesh used by one node, plus a mesh no node uses, measures 10001 and passes.
- A strip of 12 indices measures 10.

For R10, a hips rotation of `[0, 0.7071, 0, 0.7071]` measures exactly that and fails. A file with three validator errors has R02 measured 3, and R03 to R10 skipped.

`GET /api/rulebook` gives each rule's limit: R01 null, R02 0, R03 0, R04 20000, R05 64, R06 null, R07 8, R08 0, R09 2048, R10 null. `failed_count` counts only `fail`, and an upload is accepted when `failed_count` is 0. Only for accepted models, the server makes a 256 by 256 PNG front silhouette, graphite on paper.

**Story layout.** Every chapter of every story uses one layout on the ground plane, with x and z from −20 to 20 metres:

| Feature | Position | Effect |
|---|---|---|
| Spawn | (0, 0) | Starting point |
| Ink motes `m1`, `m2`, `m3` | (4, 0), (4, 4), (0, 4) | Collected by the first hero within 1 metre at the end of a tick, or by a swing that reaches them |
| Checkpoint | (-4, 0) | Reached by a hero within 1.5 metres at the end of a tick |
| Gate | (0, -8) | Opens once all three motes are collected; a hero within 1 metre while it is open completes the chapter |
| Ink puddle | centre (-8, -8), radius 2 metres, edge included | Damages heroes inside it |

**Fixed-step world.** The server runs every session, solo or co-op, at exactly 20 ticks per second. The tick number starts at 0 when the session is created, rises by 1 per tick, and never goes back. Clients send only intents.
- An intent is applied on the first tick after it arrives. Its ack carries that tick, and so does the ack of an intent that is not applied.
- `move_to` sets the hero's target on the tick it applies. On every following tick the hero moves 0.2 metres in a straight line toward the target, or lands exactly on it when it is closer than that. So k ticks after the ack's tick, a hero walking from the spawn toward (4, 0) stands at x = the smaller of 4 and 0.2 × k.
- A `move_to` target outside the ground is acked `out_of_bounds`.
- `swing` collects every uncollected mote whose distance from the hero is at most 1 + the weapon's stored `reach_m`. With reach 1.00, a mote 2.00 metres away is collected and one 2.05 metres away is not.
- A swing applied fewer than 20 ÷ `swing_per_s` ticks after the hero's last applied swing is acked `cooldown`. A swing with no weapon is acked `no_weapon`.
- Health starts at 100. Each tick a hero ends inside the puddle costs 0.5 health, so a hero at full health standing inside is knocked out on the 200th tick.
- At 0 health the hero is knocked out. On the same tick it returns to the checkpoint (if the checkpoint was reached or resumed in this session) or to the spawn, with 100 health. Collected motes stay collected.
- Pickups, damage, checkpoints, the gate and completion all come from the server as session stream events. No client decides any of them.
- A member's session hero follows their equipped hero. Saving it (pose included), equipping another hero, or changing its weapon or model reaches every member's snapshot within 1 second.

**Checkpoints and progress.**
- When a hero reaches the checkpoint, the server saves the chapter's checkpoint in Postgres with exactly the motes collected at that tick.
- Motes collected later are saved only when a hero reaches the checkpoint again (after leaving its 1.5-metre radius) or the chapter completes.
- Completing a chapter adds it to `completed_chapters`, raises `unlocked_chapter` to the next chapter where one exists, clears the checkpoint and sets the session to `complete`.
- Starting an unlocked chapter that has a saved checkpoint answers `resumed_from_checkpoint:true`, and heroes start at (−4, 0) with 100 health and only the saved motes collected. Otherwise the answer is `false` and heroes start at the spawn.
- Starting an existing chapter above `unlocked_chapter` answers 409 `chapter_locked`.
- Starting a new solo session ends the player's running solo session. Motes it collected after its last checkpoint save are lost.

For example, a player who collects m1, reaches the checkpoint, collects m2 and leaves resumes with only m1 collected.

**Chapter-complete route.** A completing session sends `session_complete` on its session stream, and a later `join_session` for it is refused with `session_complete`. A viewer may see `/stories/<story id>/chapters/<n>/complete` only when chapter `<n>` is in their solo progress's `completed_chapters` (for the solo story) or in their current party's (for co-op stories).

**Running sessions across a restart and across copies.**
- The server writes each running session's state to Postgres at least once per second, and at every pickup, checkpoint, gate opening and completion. The state is the tick, positions, health, motes, gate, checkpoint flag and members.
- On start, the server resumes each running session from its last write, with the tick continuing from the stored value and never stepping twice. Every member counts as dropped, with a fresh grace starting at the restart.
- When several copies of the app share one database, each running session is stepped by exactly one copy at a time. Another copy takes a session over only after the stepping copy has stopped writing its state for 5 seconds. So a session's tick never advances faster than 20 per second.

**Connection loss.**
- The server sends a WebSocket ping frame on every realtime connection every 2 seconds.
- A connection counts as closed the moment its socket closes. It also counts as closed when it has not answered a ping within 4 seconds, and the server then closes it. So a silently lost connection, such as a browser taken offline, counts as closed within 6 seconds of going silent.
- A connection counted as closed this way is closed for every rule in this brief: sessions, parties and presence.
- A member's connections to a session are those of the account's realtime connections, from any tab, that have sent `join_session` for it. When the member's last connection to the session closes, the member is dropped at that moment. A member with two such connections is not dropped when only one closes.
- Within 1 second after the drop, every other connected member's "Session members" list on the play page, and the "Party members" list of any party lobby open for that party, shows the dropped-member line for them. End to end, the others see the seat held within 7 seconds of a silent loss and within 1 second of a closed socket.

**Intents and delivery.**
- Every intent carries a client-made `intent_id`. The server applies each `intent_id` at most once per member per session. A repeat is acked `applied:false, duplicate:true` and changes nothing.
- Every event has an `event_id` and a `seq` that rises by 1 within its stream.
- On `hello`, the server sends each event whose `seq` is above the given `resume` value for that stream, and nothing at or below it. Seq values compare as numbers, so 10 comes after 9. A followed stream missing from `resume` gets no past events.
- Seq counters and processed intent IDs live in Postgres and continue across restarts. After a restart, a stream's next event has the previous highest seq + 1, and a pre-restart `intent_id` is still acked as a duplicate.
- The client never shows an `event_id` it has already shown, including after a reload rebuilds a log.

Together these mean that across any number of reconnects, reloads and restarts, each chat line, emote, pickup and friend event appears at most once per client, and every event the client missed appears once.

**Friends.**
- A request names a display name, matched regardless of case.
- `client_request_id` makes a send idempotent. A replay with the same display name returns the stored 201 response, and the same ID with another name answers 409 `idempotency_conflict`.
- A second request between the same two players while one is open, in either direction, answers 409 `request_pending`.
- Accepting creates the friendship for both players and sends one friend event to each.

**Presence.**
- Each open realtime connection sends heartbeats as the API states. An account is online while at least one of its connections is open and has sent a heartbeat in the last 30 seconds, so closing one of several tabs keeps it online.
- The server decides offline no later than 30 seconds after the account's last heartbeat, or within 2 seconds of its last connection closing. Connection loss decides when a silent connection counts as closed.
- Each friend's open screen shows a presence change within 2 seconds of the server deciding it.
- End to end, a friend's screen shows offline within 32 seconds of the last heartbeat and within 4 seconds of the last tab closing. It shows online again within 2 seconds of the first heartbeat after being offline.

**Party member connection.** Each party member's `connection` is decided by the server, in this order:
1. `dropped` while the member is dropped from the party's running session and still inside their rejoin grace. `grace_remaining_seconds` then holds that grace's whole seconds left, rounded up.
2. Otherwise `connected` while the account is online by the Presence rule.
3. Otherwise `offline`.

Outside `dropped`, `grace_remaining_seconds` is null. A change in any member's `connection` is a party change, so the party state reaches every open party lobby within 2 seconds of the server deciding it. The party lobby shows `Online` for `connected`, `Offline` for `offline`, and the seat-held line in place of a presence word for `dropped`.

**Party state machine.** A party has 1 to 4 members and always exactly one leader.

| Transition | When |
|---|---|
| `forming → ready_check` | The leader starts a check while the party has at least 2 members |
| `ready_check → in_session` | Every member has answered ready |
| `ready_check → forming` | Any member answers not ready, any member leaves, or the server clock reaches `deadline_at`; the check ends at once in each case |
| `in_session → member_dropped` | A member is dropped, as Connection loss defines |
| `member_dropped → in_session` | No member is dropped any more: each dropped member has either rejoined within their grace or been removed when it ended while another member was connected |
| `member_dropped → forming` | A member's grace ends while no member of the session is connected |
| `in_session` or `member_dropped → chapter_complete` | A member completes the chapter |
| `chapter_complete → forming` | The leader returns the party to the lobby |

- Any other move answers 409 `wrong_state`. In particular:
  - starting a check outside `forming` answers 409 `wrong_state`;
  - answering with no running check, including after it ended, answers 409 `no_ready_check`;
  - returning outside `chapter_complete` answers 409 `wrong_state`.
- **Ready-check deadline.** `deadline_at` is the start time by the server's clock, rounded up to the next whole second, plus 20 seconds. The check ends when the server clock reaches it.
- `remaining_seconds` and `grace_remaining_seconds` are whole seconds rounded up, computed by the server from its own clock.
- Clients show these values as received and never count down from the device clock. A reloaded tab reads the same server values, and a running check stays in the party state, so a reload reopens it.

**Rejoin grace.**
- Every drop starts a fresh, full grace of `REJOIN_GRACE_SECONDS` (default 120) from the moment of that drop. A second drop never continues an earlier countdown.
- The seat belongs to the account, not to a tab. A `join_session` for the same session from any of the account's tabs within the grace gets back the same seat, position, health and party, and the party posts the rejoined line.
- The `dropped`, `rejoined` and `removed` lines are each posted once per drop, however many tabs reconnect.
- While a member is dropped and inside their grace, the session keeps them: their snapshot entry stays, with `status:"dropped"` and their `model_url`, and their model route keeps answering 200.
- **Grace ends with another member connected.** The server removes the dropped member from the session and the party, frees the seat, and posts the seat-released line. Within 1 second of the removal:
  - the removed account's requests to `GET /api/sessions/<id>`, to any `GET /api/sessions/<id>/members/<any>/model`, to the session chat messages and to `GET /api/parties/<id>` answer 404;
  - every other member's snapshot no longer lists them;
  - their model route answers 404 to everyone.

  A later `join_session` from them is refused with `not_a_member`.
- **Grace ends with nobody connected.** Nobody is removed. The session ends, every member stays in the party, the party returns to `forming`, and its progress stays at the last checkpoint. A later `join_session` for that session is refused with `session_ended`.
- A solo session whose player's grace ends simply ends, with progress at its last checkpoint.
- Reloading any member's tab, dropped or not, neither extends nor ends a grace.

**Seats and leaders.**
- Invites never hold a seat. Accepting checks the seat count and adds the member as one indivisible step.
- When several players accept at once for the last free seat, exactly one gets 200 and every other gets 409 `party_full`. Membership never goes above 4, a losing invite stays open, and the race works the same each time a seat frees again.
- An account is in at most one party, so accepting while in another party answers 409 `already_in_party`.
- An invite becomes `invite_closed` once used or declined, or when its party ends.
- Handoff makes the named member leader in one step.
- When the leader leaves or is removed, the remaining member with the earliest join time becomes leader in the same step. Simultaneous leaves still leave exactly one leader among the remaining members.
- The party ends when its last member uses Leave party. A removal never empties a party, because removal needs another connected member.

**Party system lines** are posted to the party channel as `kind:"system"` messages with a `code` and `params`. Each reader receives `text` in their own resolved language. In the copy, `<name>` is a display name, `<story>` the localised story title, `<seconds>` the configured grace, and `<n>` the ready-check count defined below.

| Code | English | 日本語 | Español |
|---|---|---|---|
| `joined` | `<name> joined the party.` | `<name>さんがパーティーに参加しました。` | `<name> se unió al grupo.` |
| `left` | `<name> left the party.` | `<name>さんがパーティーから抜けました。` | `<name> salió del grupo.` |
| `leader` | `<name> is now the party leader.` | `<name>さんがリーダーになりました。` | `<name> es ahora líder del grupo.` |
| `ready_started` | `Ready check started: 20 seconds to answer.` | `準備確認を開始しました。20秒以内に回答してください。` | `Comprobación de listos iniciada: 20 segundos para responder.` |
| `ready_passed` | `Everyone is ready. Starting <story>.` | `全員の準備ができました。<story>を開始します。` | `Todos listos. Empezando <story>.` |
| `ready_failed` | `Ready check failed: <n> not ready.` | `準備確認に失敗しました: 未準備<n>人。` | `Comprobación fallida: <n> sin confirmar.` |
| `dropped` | `<name> lost connection. Seat held for <seconds> seconds.` | `<name>さんの接続が切れました。<seconds>秒間席を確保します。` | `<name> perdió la conexión. Su puesto se reserva <seconds> segundos.` |
| `rejoined` | `<name> is back.` | `<name>さんが戻りました。` | `<name> ha vuelto.` |
| `removed` | `<name>'s seat was released.` | `<name>さんの席を解放しました。` | `Se liberó el puesto de <name>.` |

- `ready_failed` is posted once whenever a check ends without passing, whatever the cause.
- `<n>` counts the members who were in the party when the check started and did not end it ready: those who answered not ready, those still pending (the leader included), and those who left during the check even if they had answered ready. So `<n>` is always at least 1. For example, in a party of 4 where one member answers not ready at once while the other three are pending, `<n>` is 4.
- When the leader leaves during a check, the lines are posted in this order: `left`, then `ready_failed`, then `leader` for the new leader. When any other member leaves during a check, `left` comes first, then `ready_failed`.

**Co-op progress.** Each party keeps one progress record per co-op story, with the same rules as solo progress. A session started by a ready check plays the party's `unlocked_chapter` for the chosen story, resuming at its checkpoint if there is one. A member who leaves the party keeps no share of it.

**Models in sessions.** When a member deletes their model, or saves their equipped hero without it, their snapshot's `model_url` turns null within 1 second, and the model route answers 404 from then on.

**Chat rate limit.**
- A player may have at most 5 accepted messages per channel in any rolling 10 seconds. The sixth answers 429 and is not stored.
- Its `Retry-After` is the time until the oldest of those five is 10 seconds old, in whole seconds rounded up. The cooldown copy's `<seconds>` is that same value.
- Idempotent replays never count toward the limit, including a replay sent after a reconnect while five messages are already in the window.

**Verification email state.**
- An account's `verification_email` starts `not_sent`. It becomes `sent` only when the SMTP server accepts a verification email for it.
- A failed send or resend changes nothing: the state and any earlier link stay as they were.
- The hangar's unverified-email alert banner is drawn from this stored state on every load, so it survives reloads, sign-outs and new sign-ins. It shows while the account is unverified and the state is `not_sent`.
- The verification-sent copy is announced only after a send the SMTP server accepted.

**Storage notice.** An account's `storage_notice` becomes `upload_unavailable` when one of its uploads answers 503, and `delete_unavailable` when one of its model deletes answers 503. It goes back to null when its next upload answers 201 or its next model delete answers 204.

**Email links.** Verification and reset tokens are single-use and expire `MAIL_LINK_TTL_SECONDS` (default 1800) after they are sent. Sending a new verification or reset email cancels every earlier link of the same kind for that account. A token is judged in this order:
1. A token already used answers 410 `link_used`.
2. Otherwise, a token cancelled by a newer email answers 410 `link_replaced`.
3. Otherwise, a token past its lifetime answers 410 `link_expired`.

Each answer opens the matching page heading from Feedback states.

**Builder history.** Undo history lives in the page only, and neither a successful save nor a refused one clears it. A hero save sends the whole hero.

### Services (DP-03, DP-05, DP-08, DP-09, DP-10, DP-26, DP-28, DP-33, DP-52, DP-54, DP-64, DP-69)

**Postgres** (database from `DATABASE_URL`) is the system of record for:
- accounts, with sessions, locale, verification-email state and storage notice;
- heroes and slots, with revision and pose in radians;
- weapons, with strokes, stats and never-reused numbers;
- model records, with status, filename, size, SHA-256, rulebook version and report;
- friend requests and friendships;
- parties, members and invites;
- chat messages, with `client_message_id` and per-channel `seq`;
- event streams, with `event_id` and `seq` (stored as 64-bit integers and always sent as JSON integers);
- processed intent IDs;
- running session state;
- solo and party progress, with checkpoints;
- email tokens.

Everything survives a restart. The database already exists in every environment, possibly empty, and the app never creates databases. Every time it starts, it creates its tables idempotently and inserts the seed data only where it is missing.

**MinIO** (bucket from `S3_BUCKET`, which already exists in every environment, possibly empty; the app never creates buckets).
- Each original is stored at `models/<account id>/<model id>/original.glb` with content type `model/gltf-binary`, byte for byte as submitted. Its SHA-256 equals the record's `sha256`.
- The thumbnail is stored at `models/<account id>/<model id>/thumbnail.png`.
- Nothing else is written to the bucket, and no object ever exists without its model record.
- **Model delete is all or nothing.** `DELETE /api/models/<id>` first confirms with MinIO that both objects can be reached, then removes the original and the thumbnail, then deletes the record in the same request. An object that is already missing counts as removed.
  - On 204, the record is gone, the quota is freed, every hero using the model has `model_id: null`, and in-session effects follow Models in sessions.
  - If MinIO is unreachable or refuses any step, the answer is 503 `storage_unavailable`. The record, its status (`equipped` included), the quota it uses, every hero's `model_id`, both objects and any running session's `model_url` stay exactly as they were. The Models page shows the delete-outage banner from Feedback states.
- When MinIO is unreachable:
  - uploads answer 503 `storage_unavailable`, leave no record and no object, and the Models page shows the upload-outage banner;
  - model file, thumbnail and session model reads answer 503;
  - heroes whose model cannot be streamed are drawn as their stick figure;
  - every other feature keeps working.

**Mailpit over SMTP** (`SMTP_HOST`, `SMTP_PORT`, no authentication; sender read from `MAIL_FROM`, which is `Linewright <play@linewright.test>`).
- Sign-up sends one verification email to the new address. A reset request for a known address sends one reset email. Resend sends a new verification email.
- Every email's From header is exactly the `MAIL_FROM` value.
- Each email is written entirely in the account's locale. Its HTML part has a `lang` attribute of `en`, `ja` or `es`, and a plain-text part says the same.
- Both parts contain exactly one link: `<APP_PUBLIC_URL>/verify?token=<token>` or `<APP_PUBLIC_URL>/reset-password?token=<token>`.

| Email | English subject | 日本語 subject | Español subject |
|---|---|---|---|
| Verification | `Confirm your Linewright account` | `Linewright アカウントの確認` | `Confirma tu cuenta de Linewright` |
| Reset | `Reset your Linewright password` | `Linewright パスワードの再設定` | `Restablece tu contraseña de Linewright` |

When the SMTP server is unreachable:
- sign-up still answers 201, with `verification_email:"not_sent"` stored on the account, and the hangar shows the verification-not-sent banner with Resend email;
- resend answers 503 `mail_unavailable` and the banner stays;
- every well-formed reset request answers 503 `mail_unavailable`, whether or not the address has an account, and shows the reset-not-sent banner. The server tries to reach the SMTP server on every reset request, so known and unknown addresses get the same answer.

**No restart needed.** Every mail send and every storage call makes a fresh connection attempt, and a failure is never cached. While a service stays down, each attempt answers its 503 again with nothing left behind, and the app stays healthy. The first attempt after the service answers again succeeds without a restart.

Copies of the app that share one database see the same stored state. An account whose email went unsent on one copy can resend from another copy whose mail works, which clears the banner and announces the sent copy. Likewise, a model whose delete was refused on a copy whose storage is down is still listed, equipped and streaming on a healthy copy, and deleting it there succeeds.

### Seed data (DP-01, DP-31, DP-35, DP-38, DP-40)

Every seeded person is invented. There are eight verified accounts (`email_verified` true, `verification_email` `sent`, `storage_notice` null), all friends with each other. Each has one hero in slot 1, which is equipped. No account has weapons, models, progress, parties or chat.

| Email | Password | Display name | Locale | Hero name |
|---|---|---|---|---|
| `aiko@linewright.test` | `paper-lantern-01` | `Aiko_Sketch` | `ja` | `Aiko` |
| `mateo@linewright.test` | `paper-lantern-02` | `MateoTrazo` | `es` | `Mateo` |
| `robin@linewright.test` | `paper-lantern-03` | `RobinInk` | `en` | `Robin` |
| `sol@linewright.test` | `paper-lantern-04` | `SolDoodle` | `en` | `Sol` |
| `kenji@linewright.test` | `paper-lantern-05` | `KenjiLines` | `ja` | `Kenji` |
| `noa@linewright.test` | `paper-lantern-06` | `NoaPencil` | `en` | `Noa` |
| `lucia@linewright.test` | `paper-lantern-07` | `LuciaGrafito` | `es` | `Lucia` |
| `haru@linewright.test` | `paper-lantern-08` | `HaruSumi` | `ja` | `Haru` |

Every seeded hero has revision 1 and uses:
- head `round`, torso `stick`, arms `thin`, legs `thin`;
- all proportions 1.0;
- `pose.right_arm_raise` 0;
- material `graphite`;
- every accessory `none`.

So does the hero every new account gets in slot 1 at sign-up, which is named after its display name.

Stories:

| ID | Mode | Chapters | English | 日本語 | Español |
|---|---|---|---|---|---|
| `lantern-road` | solo | 3 | `The Lantern Road` | `灯籠の道` | `El camino de los farolillos` |
| `smudged-keep` | coop | 2 | `The Smudged Keep` | `にじんだ砦` | `La fortaleza emborronada` |
| `eraser-ferry` | coop | 2 | `The Eraser Ferry` | `消しゴムの渡し舟` | `El ferry de goma` |

## Technical requirements

### Deployment (DP-59)

The runtime is Node.js 22 with npm, and the code is TypeScript. `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT` (default 4173). It serves the API, the realtime socket and the built browser assets from that one port. `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` within 5 seconds of `serve` starting.

### Configuration and secrets (DP-10, DP-59, DP-60)

The app reads these at start. It never hard-codes them and never sends them to the browser:
- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- Public address: `APP_PUBLIC_URL` (used for email links and the Origin check) and `APP_PUBLIC_PORT`.
- Timers: `REJOIN_GRACE_SECONDS` (default 120) and `MAIL_LINK_TTL_SECONDS` (default 1800).

Several copies of the app may run side by side, each with its own values for these variables. Each copy uses only its own values.

### Server boundary (DP-10, DP-25, DP-34, DP-59, DP-62, DP-77)

- Same origin only: the server sends no cross-origin resource sharing headers.
- A state-changing request or realtime connection whose `Origin` header differs from the origin of `APP_PUBLIC_URL` answers 403 `cross_origin`. A request with no `Origin` header is accepted, with or without a session cookie.
- JSON bodies over 1,000,000 bytes answer 413 `body_too_large`. Upload bodies are limited as Business rules states.
- The server serves only the built assets and the API. It never serves source files, the run manifest, environment files, lockfiles, or anything in MinIO except through the owner-checked and session-checked routes. Uploaded files are never placed where the web server serves files.
- Every page route answers with an HTML shell whose `lang` attribute and document title already match the resolved locale and the screen before any script runs. On the public pages listed in the controls table, the shell already shows the Language combobox with the resolved language selected.
- **Page routing**, decided in this order:
  1. A path that is not one of the page routes named in Screens and layout is an unknown route. It answers HTTP 404 with the not-found page, whether or not the request is signed in, and is never redirected.
  2. A signed-out request for a known page route other than `/`, `/signup`, `/signin`, `/forgot-password`, `/reset-password` and `/verify` answers 303 to `/signin`.
  3. A signed-in request for a chapter-complete route the viewer may not see answers HTTP 404 with the not-found page.
- Japanese pages preload the Noto Sans JP faces at weights 400 and 700 from the app's own origin. Both are loaded by the time the document has been parsed, so text never changes typeface after it first appears.
- Every response sets `X-Content-Type-Options: nosniff`, and model routes also set `Content-Disposition: attachment`.
- If MinIO or the SMTP server is unreachable at boot, the app still starts and answers health. If Postgres is unreachable at boot, the app retries every 2 seconds and answers health only once connected.
- Errors never expose stack traces, SQL or credentials.

### Browser support and performance (DP-16, DP-20, DP-57, DP-58, DP-68)

- Current Chromium, Firefox and WebKit, at 375x812 (touch), 768x1024 (touch) and 1280x800, at device pixel ratios 1 and 2.
- On a local connection, the hangar shows the equipped hero and accepts input within 3 seconds.
- The play page keeps at least 30 frames per second with four heroes.
- All fonts and icons are served from the app's own origin.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, and these commands install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists, with its licence, every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, icon, model and texture.
- IF-03: Every shipped package, font and asset uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, BlueOak-1.0.0, OFL-1.1 or CC0-1.0.
- IF-04: The only datastores are the provided Postgres and MinIO. There is no SQLite, Redis, embedded database or file-based store of app state.
- IF-05: Every 3D asset is made in code or is CC0, and the icons come from one ISC- or MIT-licensed line-icon set.
- IF-06: `package-lock.json` is committed and `install` uses it.
- IF-07: The provided service configuration (compose files and service definitions) is left unchanged.
- IF-08: The glTF validator R02 uses appears among the shipped packages in `package-lock.json` at exactly version 2.0.0-dev.3.10.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. `any` appears only where an untyped third-party value enters, and it is narrowed right there.
- Names in the code use this brief's domain terms: hero, slot, revision, pose, stroke, drawing revision, armoury, model, rulebook, rule, verdict, storage notice, party, leader, ready check, deadline, grace, seat, connection, session, tick, intent, mote, checkpoint, stream, seq.
- Each domain rule is decided in exactly one place in the source:
  - the upload and party state transitions;
  - the weapon stat formulas;
  - the rulebook checks and the triangle count;
  - the degree-to-radian pose rounding;
  - the drawing-plane coordinate mapping;
  - the tick step;
  - the rate limit;
  - the seat count;
  - leader succession;
  - the grace and ready-check timers;
  - connection-loss detection and the party member connection value;
  - locale resolution;
  - page routing between not-found and sign-in redirects;
  - the latest-revision check in the forge;
  - the all-or-nothing model delete.
- Every API error is built through one error shape that carries a code and a localised message. Every user-facing string comes from one translation source per language.
- No abstraction has a single implementation. No defensive check guards a state that the types and transitions already make impossible. There is no dead, commented-out or unreachable code.
- The server never trusts client-computed stats, timers, positions, ticks or verdicts, and the client never computes a countdown from its own clock.
- No feature, endpoint or screen goes beyond this brief.
