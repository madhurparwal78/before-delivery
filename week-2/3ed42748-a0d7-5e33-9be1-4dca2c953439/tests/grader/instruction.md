# Kitefold Parcel Moon

Parcel Moon is a small courier game played in the browser. It is set on Bramble, a tiny ink-outlined planet you can walk all the way around, and it comes from Kitefold, a one-person studio. Players arrive from a shared link and become couriers. They walk, jump and carry parcels to Bramble's residents. They earn stamps and spend them on satchels, look back through their stamp history, frame and take photo postcards to share, and see other couriers walking nearby. The server keeps every save, so progress survives when the browser clears its storage. A guest can claim their save through an email link and then use it on any device. The founder writes missions and resident dialogue in a console and schedules them in studio time without redeploying. A community helper can mute or rename abusive couriers from a drawer that works with the keyboard alone. The world is a tested 3D scene: the camera rigs (intro dive, follow camera, route orbit and photo camera) hold stated distances, angles and fields of view, every animation reports its state on the page, and the screen never shows a parcel, a delivery or a win before the server has confirmed it. The backend uses three services. Postgres holds all game state, MinIO stores postcard images, and Mailpit receives every email the game sends. Out of scope: passwords, social login, payments, chat, voice, native apps, and any datastore other than these three.

## Problem and users

People share small cozy browser games on forums and game portals and replay them on phones and laptops. Most of these games keep progress only inside the browser, and that progress disappears in several ways:
- Safari clears storage written by scripts for sites the player hasn't visited for a week.
- A private window throws its storage away when it closes.
- A game embedded in a portal's frame gets storage that is partitioned away from the main site.
- The player switches browsers or devices.

Players lose hours of deliveries and cosmetics and post angry threads asking where their stamps went. The solo developer spends evenings answering "my save is gone". A phone on a shaky connection retries a hand-over, an accept, a purchase or a postcard email, and the player is charged twice, given two parcels, mails a friend twice or is never paid. The screen often claims a parcel was taken before the server agreed. Shared presence is usually emoji-only and unmoderated, and couriers who left a shared laptop linger on everyone's screen. Error pages leak the names of the machines behind the game. Every new mission or line of dialogue needs a redeploy. A managed game backend costs more money and time than a one-person studio has. Parcel Moon answers this with:
- a save held on the server;
- a stamp ledger that couriers can read themselves;
- retries that count once;
- email claim of guest saves that only ever returns to Bramble's own pages;
- stored postcards;
- moderated presence that is honest about who is really there;
- a live founder console.

Users:
- **Guest courier** (occasional) arrives from a shared link and walks, jumps and delivers parcels on Bramble without signing up, often on a phone with touch controls and reduced motion. Their progress stays with that device.
- **Signed-in courier** (daily) keeps stamps, satchels and postcards on every device, can check where every stamp came from, and races other couriers for rush parcels.
- **Founder** (weekly) writes resident dialogue and delivery missions and schedules them in studio time. They also set the studio time zone and see who is online. All of this happens without redeploying, often from two tabs or a laptop with no session yet, and sometimes with the keyboard alone.
- **Community helper** (occasional) mutes or force-renames an abusive courier, often with the keyboard alone, but can't touch missions or anyone's stamps.

## Journeys

1. **A guest's first delivery.**
   - *Start:* a player opens a shared link in a fresh browser with no session. The camera dives from far out, where the whole planet hangs in the sky, down to the resting pose over the shoulder of a new guest courier standing at Bramble Depot. Paper scraps drift past and clouds circle slowly.
   - *Actions:*
     - The player opens the Depot board, reads Ottoline Fennick's letter "Lantern oil for the mill" and presses "Take the parcel". The letter stays open with the button greyed out while the depot answers, and nothing moves in the world. The first answer is lost on the shaky connection, and the game retries the same accept.
     - The retry returns the parcel already opened. Only now does the letter fold. The camera pulls back to an orbit that frames both the courier and Lantern Mill, a teal thread runs over the planet to the mill, and the camera comes back, once. The courier now carries a parcel box.
     - They walk with the keys. The courier stays upright everywhere on the sphere and the camera settles in behind them. They follow the compass ring while the metres count down.
     - At the door they hand the parcel over. The thread waits in its handing state. The answer is lost, and the next press resends the same hand-over.
     - Meanwhile a second guest has "Seed packets for the gourds" open when the founder retires it. Their Take the parcel answers that the errand is no longer posted, the row leaves the board, and no thread or camera move ever plays.
   - *End:* the original success comes back. A thanks letter unfolds, the Satchel balance stamps up to the new total once, and the compass notch turns into a stamp. After a reload the stamps are still there, and there was only ever one acceptance.
2. **Claiming a guest save, checking the stamps, leaving a shared laptop.**
   - *Start:* a guest has stamps and has just bought a satchel. The phone retried the purchase after a dropped answer. Another courier is watching their figure walk.
   - *Actions:*
     - They open "Claim this save", enter their email and see the confirmation copy.
     - They open the link from the email in the same browser, see that the save is claimed and press "Walk on Bramble".
     - They open Stamp history from the Satchel card and page back through it.
     - Later, on a shared laptop, they ask for another postbox key, open it there, play a little and sign out.
   - *End:*
     - The Postbox card shows their email-backed courier with the same balance and satchels.
     - The watching courier sees one figure throughout: its name tag changes from the guest name to the courier's name in place, with no fade and never two figures.
     - Stamp history shows each guest movement once, at the time it really happened, beside the courier's own movements. It shows the purchase once.
     - The old guest cookie no longer opens anything.
     - After sign-out on the laptop, the laptop's figure vanishes from every other courier's next update, while the phone tab, still playing, stays listed once.
3. **The rush race.**
   - *Start:* that morning the founder published "Comet jam run", a rush mission for Pim with three parcels. Several signed-in couriers see today's rush board reading "4 left": Comet jam run parcels 1, 2 and 3 of 3 and Moonmelon Express parcel 1 of 1, each Claim button named for its own parcel.
   - *Actions:*
     - Three couriers press Claim on Comet jam run parcels 1, 2 and 3 at the same moment, and all three win.
     - Two couriers press Claim on Moonmelon Express at the same moment. The winner then dawdles and never reaches the door.
     - The founder raises Comet jam run to five parcels and later retires it.
   - *End:*
     - Each row reads "Claiming…" until its answer arrives.
     - One Moonmelon courier sees the winning copy and a thread to Mossy Arch, and carries a rush parcel. Pressing Claim again doesn't extend their hold.
     - The other sees the parcel marked taken, and their balance doesn't change. Nothing they send can drop or deliver the winner's parcel.
     - When the hold ends, the winner's screen notices on its own within seconds, even if the tab was hidden: the thread rewinds, the parcel box leaves their hands, the row returns to Claim, the board count goes up by one and the lapse is announced once. A rival who claims at that moment wins, and the parcel is never listed twice.
     - The held Comet jam run parcel still reads "parcel 2 of 3" after the edit and the retire, while the unclaimed rows disappear.
4. **Postcards.**
   - *Start:* a signed-in courier whose display name is a row of fox emoji opens Photo mode.
   - *Actions:*
     - They drag to swing the photo camera round to face Lantern Mill, zoom in with the wheel and take a postcard. It appears in their Postbox with a share link.
     - They copy the link and mail it to a friend. The first answer is lost and the game retries; the friend gets one email showing only their display name, exactly as typed, and the link.
     - After a burst of mailing, the next send is refused, and a notice slides in with the wait time.
     - Later they revoke the postcard.
   - *End:* the revoked link shows a "returned to sender" page.
5. **The darkroom goes down.**
   - *Start:* the postcard store goes down during a session.
   - *Actions:* the courier keeps walking and delivering, and the camera keeps settling behind them. They open Photo mode, and later check the share page and the status read.
   - *End:* Photo mode says the darkroom is closed and the shutter is disabled. No page, answer or header names the machinery behind the game. Once the store returns, Photo mode reopens by itself without a server restart.
6. **The founder console.**
   - *Start:* the founder opens a copied link to the console's Lantern oil mission on a laptop with no session.
   - *Actions:*
     - The console says only the founder can open it and offers a postbox key. They request one there, open the link, and press "Open the console", which reopens that same mission.
     - Using only the keyboard, they write a new mission with three offer lines and save it as a draft. The address bar now names that mission.
     - They schedule it for a studio wall-clock time a few minutes ahead and watch it go live.
     - They try a time the clocks skip on the next daylight-saving day and are told it doesn't exist.
     - They copy the console URL into a second tab, which opens the same mission. From the first tab, now out of date, they try to change the reward and are told the mission changed. They reload, which reopens the same mission, and raise it.
     - They start another edit, press Back, are asked whether to discard, and keep editing.
     - They change the studio time zone and see the Goes live times and today's board date follow the new zone.
     - Later they retire the mission.
   - *End:*
     - Couriers already carrying the mission get the old reward, and new couriers get the new one.
     - Today's board date follows the new zone's wall clock.
     - Online now counts each courier once however many tabs they have open, and moves a guest to "signed in" as soon as that guest redeems a key.
7. **Moderation by keyboard.**
   - *Start:* a community helper signs in and opens the Moderation drawer with the keyboard. An abusive courier is waving at everyone.
   - *Actions:*
     - The helper tabs to the courier's row and mutes them. Focus lands on that row's Unmute button and stays there while the drawer reloads.
     - The founder presses Mute at the same moment and is told the courier is already muted; their focus lands on the Unmute button.
     - The helper force-renames the courier through the confirm dialog; focus lands on the row's new Rename button.
     - The muted courier tries to unmute themselves or change their presence name by sending extra fields, and is refused.
     - The helper tries to retire a mission and is refused.
     - Another courier leaves while the helper's focus is on their row; focus moves to a neighbouring row, never to the page.
   - *End:*
     - Every other courier's screen drops the courier's wave bubble at once and shows the fresh courier name on the same figure.
     - The postcard page they shared earlier now shows the new name.
     - The audit list shows exactly one mute and one rename, with the names as they were at the time.
8. **Phone, touch and reduced motion.**
   - *Start:* a guest opens the link on a phone with reduced motion turned on.
   - *Actions:* they tap the Depot board tab, read a letter and take the parcel. They walk with the on-screen stick, hop with the Jump button, and tap "Hand over parcel" at the door. Halfway, they turn reduced motion off in the phone's settings and then back on.
   - *End:*
     - With reduced motion on, there is no intro dive and no drifting sky, and the camera never sweeps.
     - A full thread appears at once, and a text readout shows the bearing and metres.
     - Turning reduced motion off brings back the turning compass ring and the drifting sky from where it froze, without replaying the thread; turning it back on stops them again, each within half a second.
     - Other couriers and notices simply appear.
     - Arrival is announced politely.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Guest save without sign-up** Opening the game without a session creates a guest courier whose stamps, satchels and open parcel are stored on the server and come back on reload in the same browser, as specified in API.
- **DP-02 — Walk and jump on Bramble** The courier walks, turns and jumps all the way around the planet under gravity that always pulls toward its centre, using keys or the touch controls, and the world region reports position, grounded state and whether a parcel is carried.
- **DP-03 — Accept a parcel** Taking a parcel from a resident's letter accepts a live standard mission, records the mission version and returns the route from where the courier stands.
- **DP-04 — Resident letters** Reading a mission or handing a parcel over opens a folded letter from the resident that unfolds from the resident's on-screen position and shows that mission version's offer or thanks lines.
- **DP-05 — Hand over at the door** A hand-over succeeds only within the door distance set in Business rules and awards the stamps of the mission version the courier accepted.
- **DP-06 — Retried hand-overs count once** Repeating a hand-over with the same hand-over ticket returns the original successful result unchanged without awarding stamps again, even after a rush hold has lapsed, while error answers are never kept and reusing a ticket for a different hand-over is refused, as qualified in Business rules.
- **DP-07 — Paired stamp ledger** Every stamp movement is two paired entries that sum to zero, and every balance the API or screen shows, including on every Stamp history page, equals the sum of all the courier's own entries.
- **DP-08 — Outfitter satchels** Couriers buy satchels with stamps without the balance ever going below zero, even when purchases arrive together, and they can wear any satchel they own, as qualified in Business rules.
- **DP-09 — Postbox key request** Asking for a postbox key emails a sign-in link and answers every well-formed address with the same status, body and timing, as qualified in Business rules.
- **DP-10 — Postbox key expiry and single use** A postbox key works once and only within the lifetime set by its environment variable, and used, expired and unknown keys are each refused with their own code.
- **DP-11 — Guest save claim merges once** Redeeming a postbox key in a guest browser merges that guest save into the courier exactly once, carrying its ledger movements with their original ids and times, its satchels, its stored tickets and its open parcel over without duplicates, and reports what it moved.
- **DP-12 — Rush board** Couriers see the day's rush parcels on the depot board, each with its status from their own point of view, under a heading that counts the parcels a claim could still win, and signed-in couriers can claim posted ones, as qualified in Business rules.
- **DP-13 — One winner per rush parcel** When several couriers claim the same rush parcel at once, including the instant a rival's hold lapses, exactly one claim succeeds and every other claimant is refused, sees the parcel taken and has no stamps reserved.
- **DP-14 — Rush hold expiry** A rush hold ends at the claim's commit time plus the hold length set by its environment variable, and from that instant, judged by the server clock as each request is processed, the hand-over is refused, the parcel is claimable and it returns to the board exactly once, as qualified in Business rules.
- **DP-15 — Drop a parcel** A courier can drop their own open parcel, which frees their hands and puts a dropped rush parcel straight back on the board, while a delivered, dropped or lapsed parcel can't be dropped.
- **DP-16 — Horizon thread readout** While a parcel is open, the route status region and the compass ring report remaining arc, bearing, ribbon fraction and route id from the courier's live position, as defined in Business rules.
- **DP-17 — Horizon thread motion** Taking a parcel plays the camera pull-back to an orbit that frames both the courier and the door, the ribbon unspool and the camera return in order within the time ranges in Motion and effects, and only a confirmed hand-over snaps the compass notch to a stamp.
- **DP-18 — Reduced-motion route readout** With reduced motion requested, taking a parcel moves no camera, the ribbon appears whole and shortens in tenths, the ring stays still, and the text readout and arrival announcement take their place.
- **DP-19 — Touch controls** On a touch screen, an on-screen move stick and a jump button let a guest walk, jump, take a parcel and hand it over without a keyboard.
- **DP-20 — Photo postcard capture** A signed-in courier in photo mode frames the view with the photo camera, which orbits and zooms by the stated steps under drag, pinch, wheel and arrow keys, and takes a postcard of that view, which lands in their postbox with a share link.
- **DP-21 — Postcard storage integrity** The server reads every chunk of an uploaded postcard and inflates its image data, storing only a structurally sound, still PNG whose pixel data has exactly the size its header promises and that lies within the stated size and dimension limits, refusing each fault with its own reason before anything is stored, and once each upload or revoke has finished a postcard record exists exactly when its stored image exists, as qualified in Business rules.
- **DP-22 — Postcard share links** Every postcard has an unguessable public link that shows the image to anyone who has it, can't change anything and serves the image with the headers listed in API so browsers never reinterpret it.
- **DP-23 — Revoke a postcard** Revoking a postcard from the postbox removes its record and its stored image, and its share link stops resolving at once.
- **DP-24 — Darkroom outage** When the postcard store is unreachable, at boot or later, walking, delivering and the rest of the game keep working while photo mode reports the darkroom closed and the store's actions answer the darkroom-closed response, as qualified in Services.
- **DP-25 — Mail a postcard** A signed-in courier mails a postcard's share link to one friend within the DP-46 limit, and the email arrives with the From name and subject defined in Services.
- **DP-26 — Display names stay on one line** Line breaks and control characters in a display name are folded into spaces when it is saved, so a name can never add email headers, recipients or a second subject line.
- **DP-27 — Post office outage** When the mail server is unreachable, postbox key requests and postcard mail fail with the post-office-closed response and copy while play continues, and a failed postcard mail uses none of the courier's mail allowance.
- **DP-28 — Shared presence and emotes** Couriers on Bramble see each other's recent positions, satchel colours and emotes within the delay set in Business rules, and the server keeps only the newest heartbeat of each page, ignoring repeated and out-of-order ones.
- **DP-29 — Presence shows only public fields** Each courier appears at most once in the presence a courier receives, and each entry carries exactly display name, satchel colour, position and emote taken from stored server state, never an email, account id or stamp balance.
- **DP-30 — Mute a courier** A community helper or the founder mutes or unmutes a courier from the moderation drawer, a repeated mute or unmute is refused, and simultaneous mutes of one courier leave exactly one success, as qualified in Business rules.
- **DP-31 — Force-rename a courier** A community helper or the founder replaces an abusive courier's display name with a fresh courier name that the courier can't change afterwards.
- **DP-32 — Helper powers stop at moderation** The server refuses every mission, studio and online-view action from a community helper and every moderation action from an ordinary courier, rather than only hiding the controls.
- **DP-33 — Moderation audit** Every successful mute, unmute and rename writes exactly one append-only audit entry that keeps the actor's role and name and the target's names as they were at that moment, staff list the entries newest first, and no method can edit or delete one.
- **DP-34 — Mission drafts with dialogue** The founder writes a mission in the console with its resident, stamp reward, kind and dialogue lines and saves it as a draft without redeploying.
- **DP-35 — Mission lifecycle** Missions move only along draft, scheduled, live and retired as defined in Business rules, a scheduled mission goes live by itself at the chosen instant within the stated scheduling window, and every illegal move is refused.
- **DP-36 — Live edits make new versions** Editing a live mission creates a new version for new acceptances and rush claims, while couriers already carrying the parcel finish on the version they accepted or claimed.
- **DP-37 — Studio time zone and daily board reset** The board date follows the studio time zone's local wall clock, with each board day starting at four in the morning local time, including on daylight-saving change days and in half-hour and 45-minute zones; only exact names from the published zone list are accepted, and a change applies from the next read and re-renders the console's go-live times, as qualified in Business rules.
- **DP-38 — Who is online** The founder console counts distinct couriers on Bramble now, split into guests and signed in, so that the parts always add up to the total and match the presence list, and the count moves at once on redeem and sign-out, as qualified in Business rules.
- **DP-39 — Run manifest and health** The app installs, builds and serves from the run manifest, listens on the public port and answers the health check.
- **DP-40 — Service credentials from environment** Every database, store and mail credential and URL is read from the environment at start, never hard-coded and never sent to the browser.
- **DP-41 — Server boundary** The server rejects cross-origin writes and oversized or wrongly typed bodies, and never serves source, configuration or credentials, as defined in Server boundary.
- **DP-42 — Responsive layout** At phone, tablet and laptop sizes, the stamp cards, compass ring and controls take their stated places with no sideways scrolling, and only open dialogs and sheets cover the central clear zone defined in Screens and layout.
- **DP-43 — Keyboard and focus order** Every control on the game screen, in its cards and dialogs, is reachable in the stated Tab order with a visible focus ring; Escape closes dialogs, and focus returns to the control that opened them.
- **DP-44 — Risograph paper look** Overlays look like perforated paper stamp-cards on a warm paper ground, with ink type, pink, teal and sun accents and small text pinned to the edges, as described in Visual design.
- **DP-45 — Procedural world** The planet, the residents' homes, the couriers, the sky scraps, the clouds and the stamp art are all drawn from code (shaders, generated geometry and SVG), with no bundled third-party 3D models or textures.
- **DP-46 — Postcard mail limit** A courier mails at most the number of postcards Business rules allows in its rolling window, across all their postcards and sessions and even when sends arrive together; the next send is refused with a wait time, and refused and failed sends use no allowance.
- **DP-47 — Requests carry only published fields** A request body carrying any key its endpoint doesn't publish, at the top level or nested, is refused whole with the unknown-field reason and changes nothing, so a courier can't set their own mute, balance or role, or their presence name or colour, as qualified in Business rules.
- **DP-48 — Stamp history pages** From the Satchel card, a courier pages through their stamp history newest first by whole movements with a cursor bound to them, so no movement repeats or goes missing while new ones arrive, merged guest movements keep their original time, and every page carries the full balance, as qualified in API.
- **DP-49 — Postcard copies carry nothing private** Postcard emails and public postcard pages carry only the sender's display name as stored at send or view time and the share link, never the sender's email, any internal id or store detail, and never a Reply-To, Sender, Cc or Bcc header.
- **DP-50 — Mute and rename reach presence at once** A mute clears the courier's current emote so the next presence read by anyone shows none and other couriers' screens drop the bubble, an unmute never revives an emote sent before or during the mute, and a rename shows on the next read.
- **DP-51 — Intro camera dive** Each load of the game opens with a camera dive from the stated far view of the whole planet down to the resting over-the-shoulder pose, always getting closer, within the stated time range; any key press or tap skips it at once, and reduced motion replaces it with a still start.
- **DP-52 — Ambient sky motion** Drifting paper scraps and a slowly orbiting ring of clouds move around Bramble while the page is visible, pause in place while it is hidden and stay still under reduced motion, with the state exposed on the world region.
- **DP-53 — Upright courier and following camera** The courier stands upright on the sphere everywhere and eases into and out of turns, and the follow camera rests at the stated distance, height, look-ahead and field of view and settles there within the stated range without ever dipping below the surface clearance.
- **DP-54 — Other couriers glide and fade** Other couriers glide between presence updates rather than jumping and fade in and out when they arrive or leave, each figure stays matched to its courier by the stated rule so a rename or redeem changes its tag in place, and under reduced motion they move and appear at once.
- **DP-55 — Interrupted animations stay continuous** An action taken while an animation is playing continues or reverses that animation from its current visual state without a jump, and every queued change, such as two balance changes in a row, plays in turn and ends on the server's value.
- **DP-56 — Hidden tab resumes in phase** When the page is hidden during a timed sequence and then shown again, each sequence picks up in the phase that matches the time that has passed, while ambient motion resumes from where it paused.
- **DP-57 — Notice motion** Each new notice fades in and slides down a few pixels in about a fifth of a second, or appears at once under reduced motion, and its phase is exposed on the Notices region.
- **DP-58 — Services reconnect without restart** Every request that needs the postcard store or the mail server tries it afresh, reusing a cached failure only for the time stated in Server boundary, so a returning service works again without a server restart.
- **DP-59 — A double-tapped purchase buys once** Every satchel purchase carries a purchase ticket, so repeating it returns the original result unchanged and buys once, reusing it for another satchel is refused, refusals are never kept, and tickets travel with a claimed guest save, as qualified in Business rules.
- **DP-60 — Another courier's parcel is invisible** Dropping or handing over a parcel that belongs to another courier answers exactly like a parcel that never existed and changes nothing, and no response ever shows a courier another courier's parcel id.
- **DP-61 — Hand-over state is honest** While a hand-over or rush claim is waiting for the server, the screen shows it as pending and never as delivered or won, a retried hand-over resends the same ticket and body, and each server answer moves the thread to its stated phase, as qualified in Interactions.
- **DP-62 — Studio-time scheduling across clock changes** The founder schedules a mission in studio wall-clock time, and the server refuses times the clocks skip, resolves times that happen twice to the earlier instant, and keeps the resolved instant when the studio zone changes.
- **DP-63 — Console is keyboard-complete** The founder can create, edit, schedule and move missions with the keyboard alone in the stated Tab order, with focus landing on the stated control after each save, error and move and never disturbed by the console refresh.
- **DP-64 — Stale console edits are refused** Every change to a mission must name the revision it was made from, so an edit or move made from an out-of-date view is refused and changes nothing, and of simultaneous edits from one revision exactly one succeeds.
- **DP-65 — The thread is really drawn** The route ribbon is drawn on screen in the route teal next to the recipient's door while a parcel is open and is gone from there shortly after the parcel closes, matching the door position the Route region reports.
- **DP-66 — Old session cookies stop working** Redeeming a postbox key always issues a new session and signing out ends the old one, so a copied earlier session cookie is refused everywhere from then on.
- **DP-67 — A repeated accept or claim returns the parcel you carry** Repeating an accept of the mission a courier already carries, or a claim of the rush parcel they hold, answers with that parcel exactly as first returned, creates nothing and never extends the hold, while any other accept or claim with full hands is refused, as qualified in Business rules.
- **DP-68 — A lapsed hold is noticed without a hand-over** While a rush parcel is open, the screen notices its hold has lapsed from a Me read at the hold end or the next board refresh, rewinds the thread, shows the row as Claim or Taken and announces the lapse exactly once within 11 seconds of the hold end, as qualified in Interactions.
- **DP-69 — Display names are measured as Unicode text** A display name holding a lone surrogate is refused, and any other is folded, trimmed, normalised to NFC and counted in Unicode code points against the 1 to 24 limit, and it reaches the friend's email exactly through encoded headers, as qualified in Business rules.
- **DP-70 — Signed-out and claimed couriers leave presence at once** Signing out or claiming a guest save removes that session from presence and Online now on the very next read, while a courier still playing in another session stays listed once at that session's newest position, and other couriers' screens show a redeemed browser as one figure whose tag changes in place.
- **DP-71 — The console editor lives in the URL** The console URL names the mission in the editor, so a reload, a copied URL and Back and Forward reopen it, an unknown mission is reported, and leaving unsaved edits by Back or Forward asks first, as qualified in Interactions.
- **DP-72 — Taking a parcel waits for the depot** While an accept is waiting for the depot, the offer letter stays open with Take the parcel disabled and no camera move, ribbon, carried parcel or route id appears; only a 201 or 200 folds the letter and starts the thread, and a refusal folds it with its copy and draws no thread, as qualified in Interactions.
- **DP-73 — A postbox key only returns to Bramble's own pages** A postbox key request may name one of the listed Bramble paths to return to, any other value is refused before any key or email is made, and the claim page's way back follows only the stored path, never a query parameter or another origin.
- **DP-74 — Every rush parcel has its own number and name** Each rush row carries its fixed parcel number and its mission's posted count for that board date, keeps them through drops, lapses, same-day slot edits and retires, and its Claim button is named 'Claim <title>, parcel <slot> of <slots>', unique on the board, while simultaneous claims on different parcels of one mission all win.
- **DP-75 — Reduced motion can change mid-walk** A change to the device's reduced-motion preference while the page is open switches every motion to its stated mode within half a second, in either direction, without a reload and without replaying the thread, as qualified in Motion and effects.
- **DP-76 — Outages and faults never describe the machinery** No response body or header, status read, share page or screen copy ever names the store or mail server's address as defined in Server boundary, the bucket, an object key, a driver or socket error or a stack frame, unexpected faults answer the fixed internal error, and no response carries X-Powered-By or a Server header.
- **DP-77 — A retried postcard mail sends once** Every postcard mail carries a mail ticket, so a repeat returns the original answer before any not-found, limit or outage answer without sending or using a slot, a ticket reused for another postcard or friend is refused, and simultaneous duplicates yield identical answers and one email, as qualified in Business rules.
- **DP-78 — The moderation drawer is keyboard-complete** In the moderation drawer the keyboard reaches every row's toggle and Rename in the stated order, and after each mute, unmute, refused repeat, rename, reload or departure focus lands on the stated control and never on the page body, as qualified in Interactions.

## Frontend

### Screens and layout (DP-01, DP-02, DP-12, DP-20, DP-37, DP-38, DP-42, DP-48, DP-71, DP-73, DP-78)

**Game screen (`/`).** A WebGL canvas fills the whole window. It shows Bramble hanging in a pale, sunlit sky, with the courier seen from over the shoulder once the intro dive ends.

On load, the page reads Me. If there is no usable session (the API answers 401), it starts a guest (DP-01). It then places the courier at Bramble Depot facing north and shows four overlays:
- **Postbox** stamp-card, top-left: the courier's display name; "Claim this save" for guests or the email for signed-in couriers; the display-name editor; the postcard list; and "Sign out" for signed-in couriers.
- **Depot board** stamp-card, top-right: today's live standard missions and the rush board, headed with the board date and the rush count, with each rush row numbered.
- **Satchel** stamp-card, bottom-left: the stamp balance, the satchel being worn, the Outfitter button and the Stamp history button.
- **Horizon compass** ring along the bottom edge, with the metres numeral beside its notch.

The emote toolbar and the Photo mode button sit bottom-right. Staff also get a Moderation button there.

**Clear zone.** The clear zone is the central rectangle of the viewport: from one third to two thirds of its width, and from one third to two thirds of its height.
- At every viewport, nothing overlaps the clear zone: no card, card tab, compass ring, status region, toolbar, button or touch control. A card whose content would reach it scrolls inside the card instead.
- Only open dialogs may cover the clear zone. The card sheets at 375 wide count as dialogs for this rule. The Photo mode dialog is a frame along the edges whose centre is see-through, so the planet stays visible there.
- With every sheet and dialog closed, the clear zone shows only the planet, the sky, the couriers and the route ribbon.

**When values update:**
- The Depot board, including its rush count and parcel numbers, refreshes every 10 seconds while the page is visible, right after every accept, claim, drop and hand-over answer, and at once when a hidden page is shown again.
- The balance updates from each hand-over or purchase response.
- Other couriers' positions follow the presence delay in Business rules.
- A lapsed rush hold shows within the limit in Interactions.

**Viewports.** Nothing ever scrolls sideways.
- **1280x800:**
  - Each card is pinned in its corner and is 240 to 320 pixels wide.
  - The compass ring is centred along the bottom, within 8 pixels of the horizontal centre, and is 512 to 768 pixels wide.
- **768x1024:**
  - The cards stay in the same corners and are 200 to 280 pixels wide.
  - The ring is centred within 8 pixels and is 384 to 576 pixels wide.
  - The Depot board shows up to four rows and scrolls inside the card.
  - On a touch screen, the move stick sits bottom-left and the Satchel card moves up above it.
- **375x812:**
  - The three cards fold into a row of small stamp tabs along the top: Postbox, Depot board, Satchel.
  - Tapping a tab opens that card as a sheet covering at most the top half of the screen. Only one sheet is open at a time.
  - The compass ring sits at the bottom between the move stick (bottom-left) and the Jump button (bottom-right). It is 120 to 180 pixels wide and overlaps neither.
  - The emotes are tucked behind a single Emotes button.

**Letters, Stamp history, Outfitter and the confirm dialogs** are dialogs over the canvas. At 375 wide, each fills the screen width, with a paper margin on each side.

**Photo mode** keeps the canvas full-bleed. A thin paper frame runs round the edges: a top strip holding the Darkroom status and a bottom strip holding "Take postcard" and "Leave photo mode". Every other overlay except Notices is hidden while it is open.

**Moderation drawer** slides in from the right edge as a paper panel: 320 to 400 pixels wide at 1280 and 768, the full width at 375. It lists one row per online courier (name, then the Mute or Unmute button, then the Rename button), then the Audit list, then "Close moderation" at its foot.

**Stamp history dialog.** It shows the following, top to bottom:
- the balance as "<balance> stamps";
- the Movements list, newest first, one row per movement;
- the "Show older" button under the list.

**Claim page (`/claim?token=<token>`).** A single paper card. It redeems the key as soon as it loads, shows the outcome and offers one way back, as set out in Interactions.

**Founder console (`/console`).** A paper page, not a canvas. Its address names the mission in the editor, as set out in Interactions.
- At 1280 wide, the Missions list is on the left and the mission editor on the right, with Studio and Online now below them.
- At 768 and 375 wide, everything sits in one column in this order: Missions, editor, Studio, Online now.
- The Missions table, Today's board and Online now refresh every 5 seconds. Each of these therefore shows within 5 seconds:
  - a scheduled mission turning live, with its new revision;
  - Goes live cells re-rendered in a new studio zone;
  - Online now reflecting a redeem or sign-out.
- Anyone who isn't the founder sees only the console-refusal card: the refusal copy from Feedback states and "Walk on Bramble". For a visitor with no session or a guest session, the card also holds the Email field and "Send postbox key".

**Public postcard page (`/p/<token>`).** A paper page with the postcard image framed as a stamp, the heading "A postcard from Bramble" and the caption "Sent by <display_name>". Nothing else on the page identifies the sender or the postcard.

### Public screens and controls (DP-02, DP-04, DP-08, DP-09, DP-12, DP-15, DP-16, DP-19, DP-20, DP-23, DP-25, DP-28, DP-30, DP-31, DP-33, DP-34, DP-35, DP-37, DP-38, DP-43, DP-48, DP-51, DP-52, DP-53, DP-54, DP-55, DP-57, DP-61, DP-62, DP-63, DP-65, DP-68, DP-71, DP-72, DP-73, DP-74, DP-78)

Only these roles, accessible names, copy and attributes are public. Everything else is up to you.

Placeholders:
- `<title>` is the mission title.
- `<resident name>` and `<home>` come from the resident seed record.
- `<satchel name>` is the satchel's name.
- `<name>` is a courier's current display name.
- `<balance>` is the stamp balance as a whole number.
- `<board_date>` is the board date as `YYYY-MM-DD`.
- `<rush_left>` is `rush_left` from the latest depot read, as a whole number.
- `<slot>` and `<slots>` are a rush row's `slot` and `slots` from the latest depot read.

Attribute values and timings are defined in Business rules and Motion and effects.

| Role and accessible name | Where | Visible copy and attributes |
|---|---|---|
| `region "Bramble"` | game canvas wrapper, focusable | `data-scene` (`loading`, `ready` or `no-webgl`); `data-camera` (`intro`, `over-shoulder`, `orbit` or `photo`); `data-camera-dist-m` (straight-line distance from the camera to the courier's feet, one decimal); `data-camera-fov` (vertical field of view, whole degrees); `data-camera-alt-m` (one decimal); `data-camera-settled` (`true`/`false`); `data-photo-yaw-deg` (whole degrees 0 to 359, or `""` outside Photo mode); `data-courier-screen` (`"<x>,<y>"`, the courier's feet projected through the current camera in whole viewport pixels, or `""` when off screen); `data-lat` and `data-lon` (degrees, two decimals); `data-grounded` (`true`/`false`); `data-heading-deg` (whole degrees 0 to 359); `data-courier-tilt-deg` (one decimal); `data-carrying` (`none`, `standard` or `rush`); `data-intro` (`playing`, `done`, `skipped` or `off`); `data-ambient` (`running`, `paused` or `off`); `data-cloud-deg` (whole degrees 0 to 359) |
| `list "Couriers nearby"` | visually hidden, beside the canvas | one `listitem` per drawn figure of another courier, whose text is the figure's tag (their display name); attributes `data-shown-lat` and `data-shown-lon` (two decimals), `data-fade` (`in`, `shown` or `out`) and `data-emote` (the emote whose bubble is shown, or `""`) |
| `complementary "Postbox"` | top-left card | heading "Postbox" |
| `complementary "Depot board"` | top-right card | heading "Depot board"; rush section heading "Rush board · <board_date> · <rush_left> left" |
| `complementary "Satchel"` | bottom-left card | heading "Satchel"; "Wearing <satchel name>" |
| `status "Stamp balance"` | Satchel card | "<balance> stamps"; attributes `data-balance-shown` (the numeral currently drawn) and `data-stamp-presses` (presses finished since the page loaded) |
| `button "Postbox"`, `button "Depot board"`, `button "Satchel"` | card tabs, 375 wide only | carry `aria-expanded` |
| `button "Read <title>"` | one per live standard mission on the Depot board | the title and "+<reward> stamps" |
| rush row | one per rush parcel, in API order | Text starts "Parcel <slot> of <slots>", then the title. A row reading `posted` holds `button "Claim <title>, parcel <slot> of <slots>"` whose visible text is "Claim"; while its claim waits, the visible text is "Claiming…" with `aria-disabled="true"` and the same name. A `taken` row shows the text "Taken" in place of the button, your own `yours` row shows "Yours", and one you delivered shows "Delivered" |
| `dialog "Letter from <resident name>"` | resident letter | Offer or thanks lines. `data-unfold-from` is `"<x>,<y>"`, the viewport pixels of the resident's door on screen, clamped to the viewport edge. Also `data-fold` (`unfolding`, `open` or `folding`) and `data-fold-progress` (0.00 to 1.00) |
| `button "Take the parcel"`, `button "Not now"` | offer letter | as named; "Take the parcel" carries `aria-disabled="true"` while its accept waits |
| `button "Fold letter"` | thanks letter | as named |
| `status "Route"` | next to the compass ring | Readout text. Attributes: `data-route-id`, `data-arc-remaining-m`, `data-bearing-deg`, `data-ribbon-fraction` and `data-ribbon-visible` (0.00 to 1.00); `data-thread-phase` (`idle`, `pullback`, `unspool`, `return`, `walking`, `arrived`, `handing`, `delivered` or `rewind`); `data-door-screen`, which is `"<x>,<y>"` (the recipient door's centre projected through the current camera, in whole viewport pixels) or `""` when there is no open parcel or the door is behind the planet or off screen |
| `img "Horizon compass"` | bottom ring | `data-ring-deg` (whole degrees) and `data-notch` (`idle`, `bearing` or `stamp`) |
| `button "Hand over parcel"` | shown while the thread phase is `arrived` or `handing` | as named; `aria-disabled="true"` during `handing` |
| `button "Drop parcel"` | Satchel card, while a parcel is open | as named |
| `button "Stamp history"` → `dialog "Stamp history"` | Satchel card | "<balance> stamps"; `list "Movements"`, one `listitem` per movement reading "+<n> stamps · Delivery" or "−<n> stamps · Outfitter", where `<n>` is the size of the courier entry; `button "Show older"` |
| `group "Move stick"` | touch screens only | a round paper pad with an ink knob |
| `button "Jump"` | touch screens only | an up-arrow icon |
| `button "Outfitter"` → `dialog "Outfitter"` | Satchel card | Each row shows the satchel name and "<price> stamps". It also shows one of: `button "Buy <satchel name>"` for an unowned satchel, `button "Wear <satchel name>"` for an owned satchel not being worn, or the text "Wearing" for the worn one |
| `button "Claim this save"` → `dialog "Claim this save"` | Postbox, guests only | `textbox "Email"`, `button "Send postbox key"` |
| `textbox "Display name"`, `button "Save name"` | Postbox | as named |
| `button "Sign out"` | Postbox, signed-in only | as named |
| `list "Postcards"` | Postbox, signed-in only | one `listitem` per postcard, each with `button "Copy link"`, `button "Mail to a friend"` and `button "Revoke postcard"` |
| `alertdialog "Revoke postcard"` | from Revoke postcard | "Revoke this postcard? Its link will stop working."; `button "Revoke"`, `button "Keep it"` |
| `dialog "Mail a postcard"` | from Mail to a friend | `textbox "Friend's email"`, `button "Send postcard"` |
| `button "Photo mode"` → `dialog "Photo mode"` | bottom-right | `button "Take postcard"`, `status "Darkroom"`, `button "Leave photo mode"` |
| `toolbar "Emotes"` | bottom-right | `button "Wave"`, `button "Cheer"`, `button "Sleepy"`, `button "Heart"` |
| `button "Emotes"` | 375 wide only | opens the toolbar |
| `button "Moderation"` → `dialog "Moderation drawer"` | helper and founder only | One row per courier in the staff view, with `button "Mute <name>"` or `button "Unmute <name>"`, and `button "Rename <name>"`. Then `list "Audit"` with the latest 20 entries, each reading "<actor> muted <target>", "<actor> unmuted <target>" or "<actor> renamed <target before> to <target after>". `<actor>` is the entry's `actor_display_name`, and the target names are the entry's snapshot names. Then `button "Close moderation"` |
| `alertdialog "Rename courier"` | from Rename <name> | "Give <name> a fresh courier name?"; `button "Cancel"`, `button "Rename"` |
| `status "Notices"` | every screen, at the top edge | all feedback copy; `data-notice-phase` (`idle`, `entering`, `shown` or `leaving`) |
| `main "Founder console"` | `/console` | heading "Founder console" |
| `region "Missions"` | console | `table "Missions"` with the columns Title, Status, Version and Goes live, and one `button "Edit <title>"` per row; `button "New mission"` |
| `form "Mission editor"` | console | Fields: `textbox "Title"`, `combobox "Resident"`, `spinbutton "Stamp reward"`, `radiogroup "Kind"` with `radio "Standard"` and `radio "Rush"`, `spinbutton "Rush slots"` (shown only while Kind is Rush), `textbox "Offer lines"` and `textbox "Thanks lines"` (one dialogue line per text line), and `textbox "Go live at"` (studio wall time typed as `YYYY-MM-DD HH:MM`). Buttons: "Save draft" (new mission only) and "Save changes" (existing draft, scheduled or live mission), then the move buttons "Schedule", "Publish now", "Unschedule" and "Retire", each shown only when that move is legal |
| `dialog "Discard changes?"` | console, on Back or Forward with unsaved edits | the text "Your unsaved edits to this mission will be lost."; `button "Discard"`, `button "Keep editing"` |
| `region "Studio"` | console | `combobox "Studio time zone"`, listing exactly the accepted zone names from Business rules; `button "Save time zone"`; the text "Today's board: <board_date>" |
| `region "Online now"` | console | "<n> couriers on Bramble (<g> guests, <s> signed in)", where `<n>`, `<g>` and `<s>` are `online`, `guests` and `signed_in` from the Online now endpoint |
| console refusal card | `/console` for anyone but the founder | the refusal copy; `button "Walk on Bramble"`; for no session or a guest session also `textbox "Email"` and `button "Send postbox key"` |
| `button "Walk on Bramble"` / `button "Open the console"` | claim page | exactly one of the two, as set out in Interactions |

**Goes live cells.** A scheduled mission's Goes live cell shows its `live_at` in the current studio time zone as `YYYY-MM-DD HH:MM`. Every other status shows "—".

### Interactions (DP-02, DP-03, DP-04, DP-05, DP-15, DP-19, DP-20, DP-23, DP-25, DP-28, DP-30, DP-31, DP-43, DP-48, DP-51, DP-53, DP-59, DP-61, DP-62, DP-63, DP-67, DP-68, DP-71, DP-72, DP-73, DP-77, DP-78)

- **Intro skip.** While `data-intro` is `playing`, any key press, tap or click anywhere ends the dive at once. A key press that skips does nothing else. A click or tap on a control both skips and activates that control.
- **Walking with the keyboard.** These keys work when focus is on the Bramble region or the page body, never in a text field and never while Photo mode is open:
  - W or Up walks forward and S or Down walks back.
  - A or Left turns left and D or Right turns right.
  - Space jumps.

  Movement details:
  - The courier walks at 4 metres per second and turns at a third of a full turn per second once a turn is under way.
  - A jump leaves the ground for under a second, and `data-grounded` reads `false` during it.
  - Gravity always points at the planet's centre, so walking forward long enough takes the courier all the way round.
  - `data-lat`, `data-lon` and `data-heading-deg` update at least five times per second while the courier moves or turns.
- **Walking with touch.** Touch controls appear when the device's main pointer is coarse.
  - Dragging the Move stick's knob up or down walks forward or back. Dragging it sideways turns. The further the knob is from the centre, the faster the courier goes.
  - Letting go recentres the knob and stops the courier.
  - Tapping Jump jumps.
- **Taking a parcel (DP-72, DP-67).** "Read <title>" opens the offer letter, which unfolds from the resident's door on screen. "Not now" closes the letter without accepting.
  - **Pressing.** "Take the parcel" sends the accept at the courier's current position. From that press until a definitive answer, the button stays in the Tab order with `aria-disabled="true"` and ignores presses, so a double click or a double Enter sends exactly one request (automatic retries aside).
  - **While the accept waits:**
    - the letter stays open, with `data-fold` `open` and `data-fold-progress` 1.00;
    - `data-thread-phase` stays `idle`, `data-camera` stays `over-shoulder`, `data-ribbon-visible` reads `0.00`, `data-route-id` is empty, `data-notch` is `idle` and `data-carrying` is `none`;
    - "Drop parcel" is absent, and no route teal is drawn anywhere on screen.
  - **Retries.** On a network failure (no HTTP answer), the client retries up to three times, about one second apart, with the identical request, and the letter stays open. After the third failed retry, the client reads Me. If `open_parcel` is set, it is handled as a 201 below, once. Otherwise the letter stays open, the button is enabled again and the "couldn't reach the depot" copy from Feedback states shows.
  - **201 or 200.** A 200 answer (the repeated accept in Business rules) is handled exactly like a 201. The letter folds; the pull-back starts once the fold has reached 0.00, never earlier. `data-carrying` becomes `standard` when the fold starts. The Horizon thread plays its pull-back, unspool and return once per press, whatever the number of retries, and `data-route-id` equals the answer's `route_id`. The success copy appears once.
  - **`mission_not_live`.** The letter folds, its copy shows, and the board refreshes at once, removing the "Read <title>" row. The thread phase never leaves `idle`.
  - **`hands_full`.** The letter folds and its copy shows. The parcel the courier already carries keeps its route id, phase, ribbon and notch unchanged.
- **Handing over (DP-61).** Within the door distance, the thread phase becomes `arrived` and "Hand over parcel" appears.
  - **Sending.** Clicking or tapping it, or pressing Enter in the world, sends the hand-over. The phase becomes `handing` until a definitive answer arrives.
  - **During `handing`:**
    - the button stays in the Tab order with `aria-disabled="true"` and ignores presses;
    - `data-notch` stays `bearing` and `data-carrying` is unchanged;
    - `data-ribbon-visible` keeps tracking the live position;
    - `data-balance-shown` and `data-stamp-presses` don't change;
    - no thanks letter opens.
  - **Retries.** On a network failure (no HTTP answer), the client retries up to three times, about one second apart, with the identical request. After the third failed retry, the phase returns to `walking` or `arrived` according to the live arc.
  - **One ticket per acceptance.** The client keeps one hand-over ticket for each acceptance until a 201 or `already_delivered` arrives or the acceptance closes.
    - The next press after a network failure resends exactly the same request: the same ticket, the same body and the position captured at the first press.
    - The next press after any other non-201 answer keeps the ticket and sends the current position.
  - **Answers.**
    - A 201 plays the Delivered sequence, `data-carrying` becomes `none`, and the thanks letter unfolds from the resident's door.
    - `already_delivered` shows its copy and the thread shows `delivered`.
    - `hold_expired` applies the lapse below.
    - `too_far` returns the phase to `walking` or `arrived` according to the live arc.
  - **Never early.** `data-thread-phase` `delivered` and `data-notch` `stamp` are never shown before the server has answered 201 or `already_delivered`.
- **Rush claim (DP-67, DP-74).** "Claim <title>, parcel <slot> of <slots>" claims that parcel at the current position.
  - While the claim waits, the row reads "Claiming…" and ignores board refreshes, and `data-carrying` stays as it was.
  - Network failures are retried as for Take the parcel, with the identical request, and end the same way.
  - It reads "Yours", `data-carrying` becomes `rush`, and the Horizon thread starts, only after a 201 or 200. It reads "Taken" only after `parcel_taken`.
  - Any other answer returns the row to "Claim".
  - Each claim answer is announced once in Notices.
- **Rush hold lapses (DP-68).** While a rush parcel is open:
  - **Server clock.** The client keeps the offset between the `Date` header of its latest API response and its own clock, and judges `hold_expires_at` by that server clock.
  - **Reads.** It reads Me at the moment `hold_expires_at` arrives by the server clock, and the depot on every 10-second board refresh.
  - **Applying a lapse.** The first read that shows the open rush parcel is no longer the courier's (`open_parcel` is null or is a different acceptance, and their row for that `rush_id` isn't `delivered`), or a hand-over answered `hold_expired`, applies the lapse once:
    - the `rewind` phase plays, after which the phase and notch are `idle`;
    - `data-carrying` becomes `none`;
    - the `hold_expired` copy from Feedback states is written to Notices exactly once;
    - the Route text is empty;
    - "Hand over parcel" and "Drop parcel" disappear;
    - the row shows "Claim", or "Taken" if a rival has claimed it, with the same parcel number, and the rush count follows that read.
  - **Deadline.** The whole change has finished within 11 seconds of `hold_expires_at`.
  - **One announcement.** A Me read, a board refresh and a `hold_expired` hand-over answer arriving for the same lapse produce one announcement in total.
  - **Hidden page.** If `hold_expires_at` passed while the page was hidden and no 201 was received, within a tenth of a second of the page being shown the lapse has been applied (thread `idle`, copy shown once). The client then reads Me and the depot at once.
- **Drop.** "Drop parcel" drops the open parcel and rewinds the thread; `data-carrying` becomes `none` on the answer.
- **Outfitter (DP-59).**
  - Each press of "Buy <satchel name>" creates one new purchase ticket.
  - On a network failure, the client retries up to three times, about one second apart, with the same ticket.
  - After a success, the row offers "Wear".
  - "Wear <satchel name>" changes the worn satchel. Its colour changes in the world at once, and in other couriers' presence within the presence delay.
- **Stamp history.**
  - "Stamp history" opens the dialog and loads the first page of 20 movements.
  - "Show older" loads the next page using the last cursor and appends its rows below. It disappears once the server reports no older page.
  - Closing and reopening the dialog starts again from the newest page.
- **Claiming a save (DP-73).**
  - "Send postbox key" in "Claim this save" posts the email with no `return_to`. "Send postbox key" on the console-refusal card posts the email with `return_to` set to the console's current path and query exactly as shown in the address bar.
  - The claim page reads only `token` from its own address and ignores every other query parameter. It redeems the key.
  - After a successful redeem, it shows `button "Walk on Bramble"` when the answer's `return_to` is `/`, and `button "Open the console"` otherwise. Either button navigates, within the app, to exactly the `return_to` path from the answer. After a refused redeem it shows "Walk on Bramble", which goes to `/`.
  - The claim page never sends the browser to any other origin.
- **Display names.** "Save name" checks the length first in the browser, counting code points after the same folding and normalising as the server (Business rules), and shows the name copy from Feedback states without sending when it fails.
- **Photo mode (DP-20).**
  - Opening it hides every overlay except its own dialog and Notices, switches to the photo camera (Motion and effects) and checks the darkroom at once and then every 5 seconds. The courier stands still while it is open.
  - **Framing.** While Photo mode is open, whatever control inside it has focus:
    - Right arrow adds 15 to `data-photo-yaw-deg` and Left arrow subtracts 15, wrapping within 0 to 359.
    - Up arrow narrows the field of view by 5 degrees (zooms in) and Down arrow widens it by 5.
    - Each wheel event zooms in by 5 when scrolling away from the user and out by 5 when scrolling toward them.
    - Dragging horizontally on the planet with a mouse or one finger turns the yaw by 1 degree for every 4 pixels, dragging right adding.
    - Pinching with two fingers sets the field of view to the starting field of view × the starting finger distance ÷ the current finger distance, rounded to a whole degree.
    - The field of view is always clamped to 30 to 70 degrees inclusive.
  - "Take postcard" captures the current photo-camera view at 1200 by 800 pixels and uploads it. A perforated stamp edge and a "Bramble" postmark with the date are drawn into the picture.
  - "Take postcard" is disabled while the darkroom is closed and for guests.
  - "Leave photo mode" or Escape closes it, and the follow camera returns.
- **Postbox.**
  - "Copy link" copies the share link.
  - "Mail to a friend" opens the mail dialog.
  - "Revoke postcard" opens the Revoke postcard confirm. After "Revoke", the item disappears; "Keep it" or Escape closes the confirm and returns focus to "Revoke postcard".
- **Mailing a postcard (DP-77).**
  - The mail dialog holds one mail ticket while the Friend's email stays the same. Editing the address, or closing and reopening the dialog, starts a new ticket. Every press of "Send postcard" and every automatic retry sends the current ticket.
  - On a network failure, the client retries up to three times, about one second apart, with the identical request. After the third failed retry it shows the retry copy from Feedback states, and the dialog stays open.
  - A 200 closes the dialog.
- **Emotes.** Each emote button sends that emote with the next presence heartbeat; later heartbeats carry no emote. The courier's own emote bubble shows for 4 seconds.
- **Moderation drawer (DP-78).**
  - **Opening.** "Moderation" opens the drawer with focus on the first row's first button, or on "Close moderation" when there are no rows.
  - **Rows.** Rows are ordered by display name in code-point order, then by `moderation_ref`. While open, the rows and the audit list reload after each action and every 5 seconds.
  - **Tab order.** Inside the drawer, Tab runs through each row's Mute or Unmute button and then its Rename button, row by row, then "Close moderation", and wraps back to the first row. The audit list is not in the Tab order.
  - **Mute and Unmute** act at once. After the answer, whether it succeeded or was refused with `already_muted` or `not_muted`, the drawer reloads and focus lands on that row's now-current toggle: "Unmute <name>" for a muted courier, "Mute <name>" for an unmuted one.
  - **Rename** opens the Rename courier confirm with focus on "Cancel"; Tab moves between "Cancel" and "Rename" only. "Cancel" or Escape closes it and returns focus to "Rename <name>". "Rename" sends the rename; after it succeeds, focus lands on `button "Rename <new name>"` in the re-sorted row.
  - **Reloads.** A reload never moves focus while the focused courier's row still exists, and the focused button stays the same element. If the focused courier's row is gone, focus moves to the same kind of button (toggle or Rename) in the row that now holds that position, or else in the last row, or else to "Close moderation". Focus never falls to the page body.
  - **Closing.** Escape or "Close moderation" closes the drawer and returns focus to `button "Moderation"`.
- **Game keyboard and focus (DP-43).**
  - Card containers never take focus themselves; the controls inside them do.
  - Tab order on the game screen: Postbox card controls, Depot board controls, Satchel card controls, the Bramble region, Hand over parcel (when shown), Emotes, Photo mode, then Moderation (staff only). At 375 wide, the card tabs come first, in their visual order.
  - Opening a dialog moves focus to its first control and keeps Tab inside it, except where this section names another starting control.
  - Escape closes the top dialog or open sheet and returns focus to the control that opened it.
  - Enter activates the focused button.
  - Every focusable element shows a thick ink focus ring with a thin paper gap.
- **Console keyboard and focus (DP-63).**
  - **Tab order.** New mission, then each row's Edit button in row order, then the editor fields in visual order (Title, Resident, Stamp reward, Kind, Rush slots when shown, Offer lines, Thanks lines, Go live at), then the save button, then the legal move buttons in the order Schedule, Publish now, Unschedule, Retire, then Studio time zone and Save time zone.
  - **Editor.** "Edit <title>" loads that mission into the editor and moves focus to Title. "New mission" clears the editor and moves focus to Title.
  - **Kind.** `radiogroup "Kind"` is a single tab stop. Only the checked radio is tabbable, and the arrow keys move the selection and select. For an existing mission, both radios are disabled and Tab skips the group.
  - **Field errors.** When a save or schedule is refused with field errors, focus moves to the first invalid field in visual order. That field's error text is its accessible description.
  - **After a move.** After a successful save or lifecycle move, focus lands on the first move button that is legal in the mission's new state, or on "New mission" when no move is legal. Focus never falls to the page body.
  - **The 5-second refresh** never moves focus and never replaces the focused element with a new one. It never changes an editor that holds unsaved edits.
  - **Scheduling.** "Go live at" takes a studio wall time typed as `YYYY-MM-DD HH:MM`. "Schedule" sends it as `live_at_local`, with a `T` in place of the space. "Publish now" sends `{"live_at":"now"}`, so the server's own clock decides the instant. The success copy follows the `status` in the answer: "Live now — version <n>." when it is `live`, otherwise "Scheduled for <local time>.".
  - **Focus ring.** Every console control shows the ink focus ring.
- **Console URL (DP-71).**
  - **What the URL shows.** The console's address always matches the editor: `/console?mission=<mission_id>` while an existing mission is in the editor, `/console?mission=new` while a new, unsaved mission is, and `/console` while the editor is empty.
  - **History.** "Edit <title>" and "New mission" each add one history entry. A successful "Save draft" of a new mission replaces `?mission=new` with the new id without adding an entry. Other saves, moves and the 5-second refresh never change the URL.
  - **Loading a URL.** Loading or reloading `/console?mission=<mission_id>`, including in a second tab from a copied URL or after "Open the console", opens that mission at its current revision with focus on Title. `/console?mission=new` opens an empty new mission with focus on Title. `/console` opens an empty editor with focus on New mission.
  - **Unknown mission.** A `mission` value naming no mission leaves the editor empty, shows the unknown-mission copy from Feedback states, replaces the URL with `/console` without adding an entry and puts focus on New mission.
  - **Back and Forward, no unsaved edits.** The editor loads the mission the new URL names, as on load.
  - **Back and Forward, unsaved edits.** The editor holds unsaved edits when any field differs from what was loaded or last saved. Then Back or Forward opens `dialog "Discard changes?"` with focus on "Keep editing".
    - "Keep editing", or Escape, closes the dialog, puts the editor's own URL back in the address bar, keeps every edit and returns focus to the field that had it.
    - "Discard" drops the edits and loads the editor for the URL that Back or Forward went to.

### Visual design (DP-42, DP-44, DP-65)

- **Mood.** Tactile, sunlit and hushed. Every overlay looks like a risograph-printed stamp-card on a warm off-white paper ground, and each card carries a faint printed grain.
- **Perforated edges.** Every card, sheet, dialog and the drawer has a perforated edge on all four sides, drawn in SVG: a single row of evenly spaced half-circle bites, about ten to every hundred pixels of edge, each about a third as deep as it is wide. The bites cut right through the paper, so the planet or page shows through them. The corners are a quarter-circle bite, like the corner of a ticket stub.
- **Colour roles.**
  - Warm off-white paper is the ground of every card, dialog and console page.
  - Deep inky violet is used for all text, the planet's outlines and other line work.
  - Bright riso pink is the accent for the compass notch, primary buttons, rush parcel tape and the stamp glyph.
  - Deep teal is used only for the route ribbon, in the world and in overlays alike. The route teal is exactly red 31, green 127, blue 122 on a 0 to 255 scale.
  - Sun yellow is used for stamp awards, the selected tab and the warm band of sky near the horizon.
  - Body text is always ink on paper or paper on ink. Pink, teal and sun appear only as shapes, ribbons, notches, icons and large display numerals, so every text pair meets WCAG 2.2 AA contrast.
- **Compass ring.** A thin ink ring printed with N, E, S and W and small tick marks every 15 degrees. While a parcel is open, the notch at the top of the ring is a solid pink downward-pointing triangle. On delivery it becomes the stamp glyph: a small pink square with its own perforated edge and a five-pointed ink star in the middle. With no parcel, the notch is an ink outline triangle.
- **Type.**
  - Fraunces, a soft display serif with strong thick-thin contrast, sets card headings, the balance numeral and the metres numeral.
  - Atkinson Hyperlegible sets all body and control text.
  - Each heading step is about one fifth larger than the step below it.
  - In-game overlay text stays small and pinned to the edges.
  - The app serves both fonts itself.
- **Density.** Comfortable: generous paper margins inside each card and one idea per row. Every tap target is at least 44 pixels in both directions.
- **Composition.**
  - The planet is the centrepiece, and the cards frame it from the corners.
  - The compass ring reads as a strip of horizon along the bottom.
  - Letters look like folded paper with visible crease lines.
  - Icons come from Lucide and are drawn in ink.
- **World.**
  - Bramble is a small planet in sunlit greens and ochres. It has soft shading that looks hand-printed, and ink outlines around every shape.
  - The sky is a pale paper-wash that warms toward sun yellow at the horizon. Small torn paper scraps drift through it, and a loose ring of flat printed clouds circles the planet.
  - Each resident's home has a door marked with a small pink stamp plate. Bramble Depot is an open-air stand with nothing taller than the courier within 10 metres of it.
  - Couriers are small figures carrying satchels in their satchel colour. Other couriers carry their display name on a tiny paper tag, and an emote shows as a small paper speech bubble with its icon above the figure.
  - A courier carrying a standard parcel holds a brown paper box tied with ink string; a rush parcel's box is wrapped in pink tape. With no parcel the hands are empty.
  - **The route ribbon** is drawn flat, with no lighting or shading, in exactly the route teal. It is at least 4 pixels wide on screen and is hidden wherever the planet stands in front of it.
    - While the phase is `walking`, `arrived` or `handing`, the door is on screen and `data-ribbon-visible` is 0.05 or more, at least one pixel within 24 pixels of the `data-door-screen` point is within 24 of the route teal on each of red, green and blue.
    - From 400 milliseconds after the phase becomes `delivered`, or after a rewind reaches `idle`, no pixel within 48 pixels of the last reported door point is that close to the route teal.
    - These rules hold under reduced motion too.
  - Everything is drawn from code (DP-45).

### Motion and effects (DP-04, DP-16, DP-17, DP-18, DP-20, DP-50, DP-51, DP-52, DP-53, DP-54, DP-55, DP-56, DP-57, DP-61, DP-67, DP-68, DP-72, DP-75)

All overlay motion shares one feel: it starts quickly, settles softly and never overshoots its resting point. Every time range below is inclusive and measured on the page's own clock. Distances are in metres on Bramble.

- **Card hover and press.** A card or button lifts slightly and its shadow deepens in under a fifth of a second. It settles flat on press.
- **Notices (DP-57).**
  - Each new notice text fades in while sliding down 8 to 12 pixels from the top edge into its resting place, over 0.15 to 0.25 seconds. `data-notice-phase` reads `entering` during this, then `shown`.
  - When the copy is cleared, the notice fades out in 0.15 to 0.25 seconds (`leaving`), and then the phase becomes `idle`.
  - A notice replaced while it is entering starts the new entry from its current position and fade, without first jumping back to its start.
- **Letter unfold.**
  - A letter grows from the resident's door on screen to its resting place near the top edge, unfolding along its creases in 0.3 to 0.5 seconds. Meanwhile `data-fold` reads `unfolding` and `data-fold-progress` rises from 0.00 to 1.00. Then `data-fold` becomes `open`.
  - Closing folds the letter back toward the same point in 0.2 to 0.3 seconds, with `data-fold` reading `folding` and the progress falling to 0.00. Then the dialog closes.
- **Stamp award.** Each confirmed balance change plays one stamp-press on the balance numeral, lasting 0.2 to 0.3 seconds.
  - At the press's midpoint, `data-balance-shown` switches to that change's new balance.
  - When the press ends, `data-stamp-presses` goes up by 1.
  - A sun-yellow glow then fades out over half a second.
- **Camera rigs (DP-51, DP-53, DP-17, DP-20).** All cameras look at Bramble with a vertical field of view reported in `data-camera-fov`.
  - **Follow camera (resting pose).** It sits 7.0 metres behind the courier along the ground, opposite the heading, and 3.5 metres above the courier's feet along the surface normal. It looks at a point 2.0 metres ahead of the courier and 1.0 metre above the ground. Its field of view is 55 degrees. At rest, `data-camera-dist-m` reads 7.4 to 8.2.
  - **Intro start pose.** It sits 240 metres from the planet's centre on the line through the courier, looking at the centre with a field of view of 40 degrees, so the whole planet shows in the first frame.
  - **Route orbit.** It sits on the outward line through the midpoint of the route's shortest path, 2.2 to 4 radii from the planet's centre, with a field of view of 55 degrees. Whenever the route arc is at most 150 degrees of the planet, from the end of the pull-back to the end of the unspool, both `data-courier-screen` and `data-door-screen` are non-empty and lie at least a tenth of the viewport width from the left and right edges and a tenth of its height from the top and bottom.
  - **Photo camera.** It orbits the courier 8.0 metres away, 20 degrees above the local horizon, looking at a point 1.0 metre above the courier's feet. Yaw 0 is directly behind the courier along their heading, and increasing yaw moves the camera clockwise round the courier as seen from above. Each opening of Photo mode starts at yaw 0 and a field of view of 50 degrees. When settled, `data-camera-dist-m` reads 7.7 to 8.3. `data-photo-yaw-deg` and `data-camera-fov` report each new target at once; the camera eases to it in 0.15 to 0.3 seconds, with `data-camera-settled` reading `false` until it rests. Opening and leaving Photo mode move the camera between the follow pose and the photo pose in 0.25 to 0.5 seconds.
  - **Clearance.** No camera ever passes through the planet or a home. `data-camera-alt-m` is the camera's height above the surface below it, and it is never under 1.5 at any moment. Where a home would block a pose, the camera moves closer along the same line until clear.
- **Intro camera dive (DP-51).**
  - On each load of `/`, the first frame shows the intro start pose. `data-camera` reads `intro` and `data-intro` reads `playing`.
  - The camera dives in a single unbroken move to the follow camera's resting pose in 1.2 to 1.8 seconds, while the field of view widens from 40 to 55 degrees. `data-camera-dist-m` never rises between samples during the dive, and every sample taken 0.4 to 0.8 seconds after the dive starts reads strictly between 8.2 and 230.
  - Then `data-camera` becomes `over-shoulder` and `data-intro` becomes `done`.
  - A skip (see Interactions) sets `data-intro` to `skipped` and `data-camera` to `over-shoulder` within a tenth of a second.
  - The courier can't walk until the dive ends or is skipped.
- **Ambient sky (DP-52).**
  - While the page is visible, `data-ambient` reads `running`. The paper scraps drift slowly, and the cloud ring orbits the planet once every 60 to 120 seconds. `data-cloud-deg` reports the ring's orbit angle and keeps increasing.
  - While the page is hidden, `data-ambient` reads `paused` and nothing in the sky moves.
  - On return, the sky continues from exactly where it paused, so `data-cloud-deg` doesn't jump by the hidden time.
- **Courier and follow camera (DP-53).**
  - **Upright.** The courier always stands along the outward surface normal, including mid-jump and on the far side of the planet. `data-courier-tilt-deg` is the angle between the courier and the normal, and it is never above 1.0.
  - **Turns.** When a turn starts, the turn rate ramps from nothing to full speed over 0.15 to 0.25 seconds. When it stops, the rate ramps back to nothing over 0.15 to 0.25 seconds. So `data-heading-deg` keeps changing briefly after the key is released.
  - **Follow.** While the courier walks or turns, the follow camera trails its resting pose. After the courier stops moving and turning, the camera settles into the resting pose in 0.3 to 0.5 seconds. `data-camera-settled` reads `false` while it catches up and `true` once it rests.
- **Other couriers (DP-54, DP-50).**
  - **Matching figures to couriers.** Presence carries no ids, so on each read the client matches entries to drawn figures in this order: first by equal display name (several figures sharing a name are paired by nearest shown position); then each remaining entry takes over a remaining figure whose courier is gone from the read, when that figure's shown position is within 20 metres of arc of the entry; every other entry is a new figure, and every unmatched figure is leaving. A figure that is taken over keeps its list item and simply updates its tag, so a rename or a redeemed guest shows as one figure whose tag changes in place, with `data-fade` staying `shown`.
  - **Glide.** When a read brings a new position for a figure, it glides along the surface from where it is currently drawn to the new position over 0.8 to 1.2 seconds. `data-shown-lat` and `data-shown-lon` pass through the values in between.
  - **Snap.** A move longer than 20 metres of arc snaps straight to the new position.
  - **Arriving.** A new figure fades in over 0.2 to 0.4 seconds, with `data-fade` reading `in` and then `shown`.
  - **Leaving.** A leaving figure fades out over 0.2 to 0.4 seconds, with `data-fade` reading `out`, and then its list item is removed.
  - **In-place changes.** A name or satchel change updates the tag and the satchel in place, without fading.
  - **Emote bubbles.** When a read shows an emote for a figure, its bubble pops in over 0.15 to 0.25 seconds and `data-emote` names it. When a read shows `null`, including the first read after a mute, the bubble pops out over 0.15 to 0.25 seconds and `data-emote` becomes `""` at once.
- **Horizon thread (the signature).** This plays when a parcel is accepted or a rush parcel is claimed, once per accept or claim press, including when the answer is a repeat (DP-67), and only after the answer has arrived (DP-72):
  1. **Pull-back, 0.3 to 0.55 seconds.** The camera pulls back from over the shoulder to the route orbit. `data-thread-phase` reads `pullback` and `data-camera` reads `orbit`.
  2. **Unspool, 0.5 to 0.75 seconds.** A teal ribbon unspools along the shortest path over the planet's surface, from the courier's feet to the door. `data-ribbon-visible` rises from 0.00 to 1.00, and the phase reads `unspool`.
  3. **Return, 0.25 to 0.5 seconds.** The camera returns over the shoulder, with the phase reading `return`. Then `data-camera` reads `over-shoulder` and the phase becomes `walking`.
  4. **Walking.**
     - The compass ring turns so its pink notch points along the bearing to the door.
     - The ribbon behind the courier fades away, so the visible ribbon runs from the courier to the door and `data-ribbon-visible` equals the ribbon fraction.
     - The metres numeral counts down.
     - Walking away makes the ribbon grow back and the numeral rise, so every step can be undone.
  5. **Arrived.** Within the door distance, the phase becomes `arrived`.
  6. **Handing.** While a hand-over waits, the phase reads `handing` and the thread holds still apart from tracking the live position, as set out in Interactions.
  7. **Delivered.** On a confirmed hand-over, the last of the ribbon fades in 0.2 to 0.3 seconds. The notch snaps to the stamp glyph (`data-notch` `stamp`) and stays until the next parcel is taken. The phase becomes `delivered` and the numeral shows 0.

  A drop, or a lapsed rush hold applied as in Interactions, starts the `rewind` phase. The ribbon shrinks toward the door from its current visible length to 0.00 in 0.25 to 0.4 seconds. Then the phase and the notch become `idle`.
- **Interrupted animations (DP-55).** No animation ever jumps when interrupted. Each one carries on from the state currently on screen:
  - A letter closed while unfolding folds back from its current `data-fold-progress`. The progress only falls, from that value to 0.00, and never first reaches 1.00.
  - A drop or lapse during pull-back, unspool or return rewinds the ribbon from its current `data-ribbon-visible`, which only falls. The camera travels from wherever it is to over the shoulder in 0.25 to 0.5 seconds.
  - A photo-camera step pressed while the camera is still easing retargets from the camera's current pose, without first reaching the old target.
  - Balance changes that arrive during a press queue up, and each plays its own full press in order. For example, a hand-over followed at once by a purchase raises `data-stamp-presses` by exactly 2, and `data-balance-shown` ends equal to the `balance` of the last response.
  - Once each interruption has played out, the screen agrees with the server: the open parcel, `data-carrying`, the balance and the board row match the latest responses.
- **Hidden page (DP-56).** The page treats itself as hidden whenever the browser's page visibility state is hidden.
  - **Timed sequences** follow elapsed real time, including the time spent hidden. These are:
    - the intro dive;
    - every Horizon thread phase change, and the rewind;
    - letter unfolds and folds;
    - stamp presses;
    - notice entries and exits;
    - other couriers' glides, fades and bubbles.

    Within a tenth of a second of the page being shown again, each sequence is in the phase it would have reached had the page stayed visible. For example, a parcel taken just before a three-second hide shows `walking` on return, and an intro hidden after half a second shows `done`. A sequence that would have finished shows its end state, and queued presses complete with the final balance shown. A `handing` phase or a pending accept lasts until its answer arrives, however long the page was hidden. A rush hold that lapsed while hidden is applied as in Interactions.
  - **Ambient motion** pauses and then resumes from where it paused, as described above.
  - **Heartbeats, presence reads and board refreshes** stop while the page is hidden.
- **Allowed continuous motion.** Only these move continuously:
  - the courier's walk cycle while moving;
  - other couriers' glides;
  - the ribbon fade while walking;
  - the ambient scraps and clouds.

  Nothing else loops: no idle spinning, bobbing, shimmering or pulsing.
- **Reduced motion.** When the device asks for reduced motion:
  - **Start.** There is no intro dive. `data-intro` reads `off` from the first frame, and `data-camera` reads `over-shoulder`.
  - **Sky.** It is still. `data-ambient` reads `off`, and `data-cloud-deg` never changes.
  - **Courier and cameras.** Turns start and stop at once. The follow camera stays rigidly at its resting pose, so `data-camera-settled` is always `true`, and it still keeps its 1.5-metre clearance. Photo-camera steps and the switch into and out of Photo mode apply at once.
  - **Other couriers** jump to each new position, appear and disappear at once with `data-fade` always `shown`, and bubbles appear and vanish at once.
  - **Horizon thread.**
    - Taking a parcel never moves the camera, which stays `over-shoulder`; once the answer arrives the letter is removed and the phase goes straight from `idle` to `walking`.
    - The ribbon appears at full length at once and shortens only in tenths. A drop or a lapse clears it at once; the lapse announcement is unchanged.
    - `handing` still applies.
    - The compass ring never turns, so `data-ring-deg` stays `0`. The Route region's text readout is visible on screen next to the ring instead.
    - Arrival is announced through the Route region.
  - **Letters** appear and disappear at their resting place without growing or unfolding. `data-fold` goes straight to `open`, and closing removes the letter at once.
  - **Card hover and press** change only the shade, with no lift.
  - **Stamp award.** The numeral changes with no press or glow, and `data-stamp-presses` still counts each change.
  - **Notices** appear and clear at once. `data-notice-phase` goes straight to `shown` or `idle`.
- **Reduced motion changing while the page is open (DP-75).** The page follows the device preference live. Within 0.5 seconds of the preference changing, with no reload:
  - **Turning it on:**
    - a playing intro becomes `data-intro` `skipped` with `data-camera` `over-shoulder`;
    - `data-ambient` becomes `off` and `data-cloud-deg` freezes at its current value;
    - `data-camera-settled` becomes `true` and stays so;
    - a thread in `pullback`, `unspool` or `return` goes straight to `walking` with the camera over the shoulder;
    - `data-ring-deg` becomes `0`, `data-ribbon-fraction` switches to tenths, and the readout shows on screen;
    - open letters jump to `open`, figures jump to their latest positions with `data-fade` `shown`, and notices jump to `shown` or `idle`.
  - **Turning it off:**
    - `data-ambient` becomes `running` and `data-cloud-deg` resumes from the frozen value without a jump;
    - `data-ring-deg` returns to the bearing, the fraction returns to two decimals and the on-screen readout hides;
    - `data-intro` keeps its value; the intro never restarts.
  - **Either way:** the phase (`walking`, `arrived` or `handing`), the route id, the notch, `data-carrying` and the ribbon pixel rules hold throughout, and the thread never replays its pull-back.

### Feedback states (DP-01, DP-03, DP-05, DP-08, DP-09, DP-10, DP-11, DP-13, DP-14, DP-15, DP-18, DP-20, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-30, DP-31, DP-32, DP-34, DP-35, DP-37, DP-46, DP-48, DP-59, DP-61, DP-62, DP-64, DP-67, DP-68, DP-69, DP-71, DP-72, DP-76, DP-77)

Every async action shows its pending copy in `status "Notices"` while it waits, then replaces it with the outcome copy. Field errors also show as text under the field, linked to it as its accessible description.

Placeholders:
- `<reward>` is the stamps awarded.
- `<time>` is the hold end in the courier's local time, as `HH:MM`.
- `<short>` is the satchel price minus the balance.
- `<email>` is the address entered.
- `<n>` is a mission version.
- `<local time>` is the go-live time in the studio time zone, as `YYYY-MM-DD HH:MM`.
- `<m>` is the `Retry-After` seconds divided by 60, rounded up to a whole number.

| Action | Pending | Success | Errors | Outage |
|---|---|---|---|---|
| Start or restore session | "Packing your satchel…" | (copy cleared) | network failure: "Couldn't reach the depot. Retrying…" (retries every 3 seconds) | — |
| Take a parcel | "Taking the parcel…" | "Parcel taken. Follow the teal thread." (also for a 200 repeat) | while retrying: "Connection wobbly — trying again…"<br>after three failed retries with no open parcel in Me: "Couldn't reach the depot. Try again."<br>`mission_not_live`: "This errand is no longer posted."<br>`hands_full`: "Your hands are full — deliver or drop your parcel first." | — |
| Hand over | "Handing over…" | "Delivered to <resident name>. +<reward> stamps." | `too_far`: "Walk a little closer to the door."<br>while retrying: "Connection wobbly — trying again…"<br>after three failed retries: "Couldn't hand over. Your parcel is still safe — try again."<br>`hold_expired`: "Your rush hold ran out. The parcel is back on the board."<br>`already_delivered`: "That parcel was already delivered." | — |
| Rush hold lapses (noticed by a Me read, a board refresh or a hand-over) | — | — | the `hold_expired` copy above, exactly once per lapse | — |
| Drop parcel | "Dropping…" | "Parcel dropped." | `parcel_closed`: "That parcel is already closed." | — |
| Claim rush parcel | "Claiming…" | "It's yours! Deliver before <time>." (also for a 200 repeat) | while retrying and after three failed retries: as for Take a parcel<br>`parcel_taken`: "Another courier got there first."<br>`sign_in_required`: "Claim your save to race for rush parcels."<br>`hands_full`: as above<br>`board_closed`: "That board has closed for the day."<br>`mission_not_live`: as above | — |
| Buy satchel | "Wrapping it up…" | "<satchel name> is yours." | `insufficient_stamps`: "You need <short> more stamps."<br>`already_owned`: "You already own this satchel."<br>while retrying: "Connection wobbly — trying again…"<br>after three failed retries: "Couldn't reach the outfitter. Your stamps are safe — try again." | — |
| Wear satchel | "Changing satchels…" | "Now wearing <satchel name>." | `not_owned`: "Buy this satchel first." | — |
| Open Stamp history / Show older | "Loading older stamps…" | (copy cleared) | any failure: "Couldn't fetch your stamp history. Try again." | — |
| Save name | "Saving…" | "Name saved." | `required`, `too_long` or `invalid`: "Names are 1 to 24 characters."<br>`name_locked`: "A community helper reset your name. It can't be changed right now." | — |
| Send postbox key (Claim this save or console refusal) | "Sending your postbox key…" | "Check your inbox for a postbox key." | invalid email: "Enter an email address like name@example.com." | "The post office is closed right now. Try again in a few minutes." |
| Redeem postbox key (claim page) | "Opening your postbox…" | "Save claimed. Your stamps travel with you now." | `link_expired`: "This postbox key has expired. Ask for a new one."<br>`link_used`: "This postbox key was already used."<br>`link_invalid`: "This postbox key doesn't fit any postbox." | — |
| Sign out | "Signing out…" | "Signed out. You're a guest courier again." | — | — |
| Take postcard | "Developing…" | "Postcard saved to your postbox." | `sign_in_required`: "Claim your save to keep postcards."<br>`postbox_full`: "Your postbox is full. Revoke a postcard to make room."<br>image rejected (any reason): "That photo didn't develop. Try again." | "The darkroom is closed. Your walk isn't affected — postcards will develop again when it reopens." |
| Copy link | — | "Link copied." | — | — |
| Revoke postcard | "Revoking…" | "Postcard revoked. Its link no longer works." | — | the darkroom copy above; the postcard stays |
| Mail postcard | "Posting…" | "Postcard mailed to <email>." | invalid email: "Enter your friend's email address."<br>`mail_limit`: "You've mailed a lot of postcards. Try again in <m> minutes."<br>while retrying: "Connection wobbly — trying again…"<br>after three failed retries: "Couldn't reach the post office. Press Send postcard again — it won't send twice." | the post office copy above |
| Emote while muted | — | "You're muted, so emotes are hidden from others." | — | — |
| Mute / unmute / rename | "Working…" | "Muted <name>." / "Unmuted <name>." / "Renamed <old name> to <new name>." | `already_muted`: "<name> is already muted."<br>`not_muted`: "<name> isn't muted."<br>`cannot_moderate_staff`: "Helpers can't moderate staff." | — |
| Open a console URL | — | — | unknown mission: "That mission isn't on the list." | — |
| Save draft / save changes | "Saving…" | "Draft saved." for a draft or scheduled mission; "Live now — version <n>." for a live edit | Under each field, for any reason on that field: "Titles are 1 to 60 characters.", "Rewards are 1 to 50 stamps.", "Pick a resident.", "Rush missions post 1 to 5 parcels a day.", "Write 1 to 6 offer lines of up to 200 characters.", "Write 1 to 3 thanks lines of up to 200 characters."<br>`mission_retired`: "Retired missions can't be edited."<br>`stale_revision`: "This mission changed in another tab. Reload it to see the latest." (the form keeps its values) | — |
| Schedule / publish / unschedule / retire | "Working…" | "Scheduled for <local time>." / "Live now — version <n>." / "Back to draft." / "Retired." | `illegal_transition`: "That mission can't move from <from> to <to>."<br>`stale_revision`: as above<br>Under Go live at:<br>`invalid`: "Enter a time like 2027-01-15 09:30."<br>`nonexistent_time`: "That time doesn't exist on the studio clock — the clocks skip it."<br>`in_past`: "Pick a time from now on."<br>`out_of_range`: "Pick a time no more than 366 days ahead." | — |
| Save time zone | "Saving…" | "Studio time zone saved. Today's board is <board_date>." | invalid: "Pick a time zone from the list." | — |
| Console without founder role | — | — | "Only the founder can open the console." | — |
| Any action answered 500 `internal` | — | — | "Something went wrong on Bramble." | — |

**Darkroom status** (`status "Darkroom"` in Photo mode):
- It reads "Darkroom open" while the darkroom is open, and the darkroom outage copy above while it is closed.
- While the darkroom is closed, postcards keep their rows in the Postbox list, and each thumbnail shows a blank paper frame with "Image in the darkroom".

**Route readout** (`status "Route"`):
- While a parcel is open, the text is "Bearing <compass label> <bearing>°, <metres> m".
  - `<compass label>` and `<bearing>` follow Business rules.
  - `<metres>` is the remaining arc rounded to the nearest whole metre.
  - The text changes at most once per second.
- On entering `arrived`, it announces "Arrived at <home>."
- With no parcel, it is empty.
- The readout is always available to screen readers. On screen it appears as text only under reduced motion; otherwise the metres numeral beside the ring shows the distance.
- The Route region and Notices are polite live regions.

**Public postcard page:** a revoked or unknown link shows a 404 paper page reading "This postcard has been returned to sender."

## Backend

### API (DP-01, DP-03, DP-05, DP-06, DP-07, DP-08, DP-09, DP-10, DP-11, DP-12, DP-13, DP-14, DP-15, DP-20, DP-21, DP-22, DP-23, DP-25, DP-28, DP-29, DP-30, DP-31, DP-33, DP-34, DP-35, DP-36, DP-37, DP-38, DP-39, DP-46, DP-47, DP-48, DP-49, DP-59, DP-60, DP-62, DP-64, DP-66, DP-67, DP-73, DP-74, DP-76, DP-77)

**Basics.**
- Every endpoint is on the app origin.
- JSON responses are `application/json; charset=utf-8`. The exceptions are the public postcard page (HTML) and its image (PNG).
- Every response carries a `Date` header.
- Request content types and empty bodies are covered under Body limits in Server boundary.
- Every time the API returns is ISO 8601 in UTC with `Z` and exactly three fractional-second digits, for example `2026-10-27T09:10:00.123Z`.
- An accept, claim or hand-over position is exactly `{"lat","lon"}`. A presence position is exactly `{"lat","lon","heading_deg"}`. Value rules are under Request bodies in Business rules.

**Sessions.**
- A session is the cookie `pm_session`: HttpOnly, SameSite=Lax, Path `/`, lasting 400 days.
- The roles are `guest`, `courier` (signed in), `helper` and `founder`. Helpers and the founder also play as couriers.
- A cookie whose session has ended or been replaced counts as no session.

**Error shape.**
- Every error body is `{"error":{"code":"<code>","message":"<sentence>"}}`.
- Every JSON 404 body is exactly `{"error":{"code":"not_found","message":"Nothing was found here."}}`.
- Every 500 body is exactly `{"error":{"code":"internal","message":"Something went wrong on Bramble."}}`.
- Two responses don't use this shape: the 503 from `GET /api/health`, whose body is in its row, and the 404 HTML returned-to-sender page from `GET /p/{share_token}`.
- A 422 adds field reasons: `{"error":{"code":"validation","message":"<sentence>","fields":{"<field>":"<reason>"}}}`. Fields inside objects use dotted paths, for example `position.lat`. A header field uses the header's name.
- Field reasons: `required`, `invalid`, `too_long`, `out_of_range`, `too_far`, `unknown_field`, `not_png`, `trailing_data`, `animated`, `bad_dimensions`, `bad_image_data`, `unknown_resident`, `fixed_after_create`, `in_past`, `nonexistent_time`.
- Generic codes: 401 `unauthenticated`, 404 `not_found`, 405 `method_not_allowed`, 412 `stale_revision`, 413 `too_large`, 415 `unsupported_media_type`, 428 `precondition_required`, 429 `mail_limit`, 500 `internal`.

**Error precedence.** One order applies to every endpoint and path, including `/p/...` and the endpoints open to anyone. Each step applies only where that check exists for the request, and an endpoint open to anyone never answers 401.
1. Cross-origin refusal (403 `cross_origin`, see Server boundary), for state-changing requests only. It is checked before anything else, so a foreign-origin request that is also oversized, sessionless or invalid gets only this 403.
2. Body size (413) and content type (415).
3. No session (401).
4. A missing or malformed ticket header: 422 with field `Handover-Ticket` on `POST /api/deliveries`, `Purchase-Ticket` on the buy endpoint, or `Mail-Ticket` on the postcard mail endpoint.
5. On those same three endpoints, a stored replay (its stored success) or a ticket conflict (409 `ticket_conflict`), including waiting for an in-flight request with the same ticket (Business rules).
6. An unknown resource or one belonging to another courier (404), or a method the path doesn't accept (405).
7. Role refusal (403).
8. On founder mission changes (`PATCH`, `schedule`, `unschedule`, `retire`), a missing `If-Match` (428) or one that isn't the current revision (412).
9. State checks: the open-parcel check for accept and claim (a repeat's 200 or `hands_full`, see Business rules), then every other state conflict (409).
10. Field and query validation (422), including malformed JSON and unknown fields.
11. The postcard mail limit (429).
12. An unreachable dependency (503).

Any unexpected fault at any step answers the fixed 500. Endpoint rows list only their own extra errors.

**Shared objects.**
- *Parcel* (an acceptance): `{"acceptance_id","mission_id","version","title","reward_stamps","resident":{"resident_id","name","home"},"rush_id":<string|null>,"hold_expires_at":<time|null>,"status":"open","route":{"route_id","door":{"lat","lon"},"total_arc_m":<one decimal>,"initial_bearing_deg":<integer 0..359>},"dialogue":{"offer":[<string>]}}`.
  - `acceptance_id` is `acc_` followed by at least 16 lowercase letters or digits. It carries at least 80 bits of randomness and is unrelated to any other id.
  - The route is measured from the position sent with the accept or claim that created the acceptance.
- *Me*: `{"role","display_name","satchel_colour","balance","email":<string|null>,"name_locked","muted","satchels_owned":[<satchel_id>],"open_parcel":<Parcel|null>}`. The email is only ever the caller's own, and it is `null` for guests.
- *Founder mission*: `{"mission_id","title","resident_id","reward_stamps","kind":"standard|rush","rush_slots":<1..5|null>,"dialogue":{"offer":[..],"thanks":[..]},"status":"draft|scheduled|live|retired","version","revision":<integer ≥ 1>,"live_at":<time|null>}`.
  - `mission_id` is 1 to 64 characters from a–z, 0–9 and `-`. A new mission's id is made from its title.
  - Every response whose body is a single Founder mission carries the header `ETag: "<revision>"`, the revision in double quotes.
- *Movement*: `{"movement_id","kind":"delivery|purchase","created_at","entries":[{"account":"courier|mint|outfitter","amount":<integer>,"ref"}]}`.
  - `entries` holds exactly the movement's two entries, the `courier` entry first.
  - `ref` is the `mission_id` for a delivery and the `satchel_id` for a purchase, and it is the same on both entries.
- *Rush row*: `{"rush_id","mission_id","slot":<1..5>,"slots":<1..5>,"title","resident_id","reward_stamps","version","status":"posted|taken|yours|delivered","hold_expires_at":<time|null>}`. `hold_expires_at` is set only on `yours` rows. `version` and `reward_stamps` follow the rush version rule, and `slot` and `slots` follow Rush parcel numbers in Business rules.

A ticket header value is 8 to 64 characters from A–Z, a–z, 0–9, `_` and `-`.

A Request cell shows the full set of keys that endpoint accepts. `?` marks an optional key, and `{}` means the body takes no keys.

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone | — | 200 `{"status":"ok"}` | 503 `{"status":"waiting_for_database"}` (see Server boundary) |
| `GET /api/status` | anyone | — | 200 `{"darkroom":"open|closed","post_office":"open|closed"}` | — |
| `GET /api/world` | anyone | — | 200 `{"radius_m","depot":{"lat","lon"},"residents":[{"resident_id","name","home","door":{"lat","lon"}}]}` | — |
| `POST /api/guest` | anyone | `{}` | 201 Me with a new guest session cookie. If a live session already exists, 200 Me for it | — |
| `GET /api/me` | any session | — | 200 Me | — |
| `PATCH /api/me` | any session | `{"display_name"?,"satchel_id"?}` | 200 Me | 403 `name_locked`<br>409 `not_owned`<br>422 `display_name` (`required`, `too_long`, `invalid`), `satchel_id` (`invalid`) |
| `GET /api/me/ledger?limit=<n>&before=<cursor>` | any session | Query only. `limit` is optional, a whole number 1 to 50, default 20. `before` is optional. Other query parameters are ignored | 200 `{"balance","movements":[Movement],"next_cursor":<string|null>}` (paging rules in Business rules) | 422 `limit` (`invalid`, `out_of_range`), `before` (`invalid`) |
| `GET /api/depot` | any session | — | 200 `{"board_date":"YYYY-MM-DD","time_zone","rush_left":<integer ≥ 0>,"missions":[{"mission_id","title","resident_id","reward_stamps","version","dialogue":{"offer":[..]}}],"rush":[Rush row]}`, rush rows ordered by `mission_id` ascending, then `slot` ascending | — |
| `POST /api/missions/{mission_id}/accept` | any session | `{"position"}` | 201 Parcel; 200 the original Parcel on a repeat (see Open parcels) | 409 `mission_not_live`, `rush_claim_required` (rush mission), `hands_full`<br>422 `position` |
| `POST /api/rush/{rush_id}/claim` | courier, helper, founder | `{"position"}` | 201 Parcel with `rush_id` and `hold_expires_at`; 200 the original Parcel on a repeat (see Open parcels) | 403 `sign_in_required` (guest)<br>409 `parcel_taken`, `hands_full`, `board_closed`, `mission_not_live`<br>422 `position` |
| `POST /api/acceptances/{acceptance_id}/drop` | owner | `{}` | 200 `{"acceptance_id","status":"dropped"}` | 409 `parcel_closed` |
| `POST /api/deliveries` | owner of the acceptance | header `Handover-Ticket: <ticket>`; body `{"acceptance_id","position"}` | 201 `{"delivery_id","acceptance_id","mission_id","version","stamps_awarded","balance","movement_id","dialogue":{"thanks":[..]}}` | 409 `already_delivered`, `parcel_dropped`, `hold_expired`<br>422 `position` (`too_far`) |
| `GET /api/outfitter` | any session | — | 200 `{"satchels":[{"satchel_id","name","price","colour","owned","worn"}]}` | — |
| `POST /api/outfitter/{satchel_id}/buy` | any session | header `Purchase-Ticket: <ticket>`; body `{}` | 201 `{"satchel_id","balance","movement_id"}` | 409 `already_owned`, `insufficient_stamps` |
| `POST /api/auth/postbox-key` | anyone | `{"email","return_to"?}` | 200 `{"status":"sent"}` | 422 `email` (`invalid`, or `too_long` over 254 characters), `return_to` (`invalid`, `too_long`)<br>503 `post_office_closed` |
| `POST /api/auth/redeem` | anyone | `{"token"}` | 200 `{"role","display_name","balance","merged_guest":<bool>,"merge_report":<object|null>,"return_to"}` with a new courier session cookie | 410 `link_invalid`, `link_expired`, `link_used` (no `return_to`) |
| `POST /api/auth/sign-out` | any session | `{}` | 204; the session ends and the cookie is cleared | — |
| `GET /api/presence` | any session | — | 200 `{"couriers":[{"display_name","satchel_colour","position":{"lat","lon","heading_deg"},"emote":<"wave"|"cheer"|"sleepy"|"heart"|null>}]}` | — |
| `POST /api/presence` | any session | `{"stream","seq","position":{"lat","lon","heading_deg"},"emote"?:<one of the four or null>}` | 200 `{"accepted":<bool>,"last_seq":<integer>,"emote":<as others will see it>,"muted":<bool>}` | 422 `stream`, `seq`, `position`, `emote` |
| `GET /api/postcards` | courier, helper, founder | — | 200 `{"postcards":[{"postcard_id","share_url","width","height","bytes","created_at"}]}`, newest first | 403 `sign_in_required` |
| `POST /api/postcards` | courier, helper, founder | raw PNG body, `Content-Type: image/png` | 201 `{"postcard_id","share_url","width","height","bytes","created_at"}` | 403 `sign_in_required`<br>409 `postbox_full`<br>422 `image` (`not_png`, `trailing_data`, `animated`, `bad_dimensions`, `bad_image_data`)<br>503 `darkroom_closed` |
| `DELETE /api/postcards/{postcard_id}` | owner | — | 204 | 503 `darkroom_closed` |
| `POST /api/postcards/{postcard_id}/mail` | owner | header `Mail-Ticket: <ticket>`; body `{"to"}` | 200 `{"status":"sent","sent_at":<time>}` | 422 `to` (`invalid`, `too_long`)<br>429 `mail_limit` with header `Retry-After: <whole seconds>`<br>503 `post_office_closed` |
| `GET /p/{share_token}` | anyone | — | 200 HTML postcard page with headers `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` | 404 HTML returned-to-sender page |
| `GET /p/{share_token}/image.png` | anyone | — | 200, bytes identical to the upload, with headers `Content-Type: image/png`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="postcard.png"` and `Cache-Control: no-store`. It has no `ETag`, no `Last-Modified` and no header whose name starts with `x-amz` | 404<br>503 `darkroom_closed` |
| any other method on `/p/...` | anyone | — | — | 405 |
| `GET /api/moderation/presence` | helper, founder | — | 200 `{"couriers":[{"moderation_ref","display_name","satchel_colour","position","emote","muted","name_locked"}]}` | 403 `staff_only` |
| `POST /api/moderation/{moderation_ref}/mute` | helper, founder | `{}` | 200 `{"display_name","muted":true}` | 403 `staff_only`, `cannot_moderate_staff`<br>409 `already_muted` |
| `POST /api/moderation/{moderation_ref}/unmute` | helper, founder | `{}` | 200 `{"display_name","muted":false}` | 403 `staff_only`, `cannot_moderate_staff`<br>409 `not_muted` |
| `POST /api/moderation/{moderation_ref}/rename` | helper, founder | `{}` | 200 `{"display_name","name_locked":true}` | 403 `staff_only`, `cannot_moderate_staff` |
| `GET /api/moderation/audit` | helper, founder | — | 200 `{"entries":[{"entry_id","action":"mute|unmute|rename","actor_role":"helper|founder","actor_display_name","moderation_ref","target_name_before","target_name_after","at"}]}`, newest first by `at`, then by `entry_id` descending | 403 `staff_only` |
| `POST`, `PUT`, `PATCH` or `DELETE` on `/api/moderation/audit` or any path below it | anyone | — | — | 405 `method_not_allowed` |
| `GET /api/founder/missions` | founder | — | 200 `{"missions":[Founder mission]}` | 403 `founder_only` |
| `GET /api/founder/missions/{mission_id}` | founder | — | 200 Founder mission | 403 `founder_only` |
| `POST /api/founder/missions` | founder | `{"title","resident_id","reward_stamps","kind","rush_slots","dialogue":{"offer","thanks"}}` (every key required) | 201 Founder mission (status `draft`, version 1, revision 1) | 403 `founder_only`<br>422 per field (reasons in Mission fields) |
| `PATCH /api/founder/missions/{mission_id}` | founder | header `If-Match: "<revision>"`; body: any subset of the create keys | 200 Founder mission | 403 `founder_only`<br>409 `mission_retired`<br>422 per field, and `kind` (`fixed_after_create`) |
| `POST /api/founder/missions/{mission_id}/schedule` | founder | header `If-Match`; body exactly one of `{"live_at":<ISO 8601 with offset or Z, or the string "now">}` or `{"live_at_local":"YYYY-MM-DDTHH:MM"}` | 200 Founder mission, with status `scheduled`, or `live` when the resolved instant has already been reached (see Mission lifecycle) | 403 `founder_only`<br>409 `illegal_transition`<br>422 `live_at` (`required`, `invalid`, `in_past`, `out_of_range`), `live_at_local` (`invalid`, `nonexistent_time`, `in_past`, `out_of_range`) |
| `POST /api/founder/missions/{mission_id}/unschedule` and `/retire` | founder | header `If-Match`; body `{}` | 200 Founder mission | 403 `founder_only`<br>409 `illegal_transition` |
| `GET /api/founder/studio` | founder | — | 200 `{"time_zone","board_date"}` | 403 `founder_only` |
| `PATCH /api/founder/studio` | founder | `{"time_zone"}` | 200 `{"time_zone","board_date"}` | 403 `founder_only`<br>422 `time_zone` (`invalid`) |
| `GET /api/founder/online` | founder | — | 200 `{"online","guests","signed_in"}` | 403 `founder_only` |

A 412 carries the header `ETag: "<current revision>"`.

**Role refusals:**
- A guest calling a courier-only endpoint gets 403 `sign_in_required`.
- An ordinary courier gets 403 `staff_only` on moderation paths and 403 `founder_only` on founder paths.
- A helper on a founder path gets 403 `founder_only`.

### Business rules (DP-05, DP-06, DP-07, DP-08, DP-09, DP-10, DP-11, DP-12, DP-13, DP-14, DP-15, DP-16, DP-21, DP-22, DP-23, DP-26, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-35, DP-36, DP-37, DP-38, DP-46, DP-47, DP-48, DP-49, DP-50, DP-59, DP-60, DP-62, DP-64, DP-66, DP-67, DP-69, DP-70, DP-73, DP-74, DP-77)

- **Request bodies.**
  - **Published keys only.** Each JSON body accepts only the keys shown in its API row, and the same holds inside nested objects (`position`, `dialogue`).
  - **Unknown keys.** Any other key, at any depth, fails the whole request with 422 `validation`. The fields map then holds exactly the unknown keys, each with the reason `unknown_field`, named by dotted path (for example `position.altitude`). Problems with the published fields aren't reported in that case.
  - **Where validation sits.** Field validation, unknown keys included, is step 10 of the error precedence. An answer from an earlier step comes first: for example a 403 `name_locked`, a 409, or the 200 of a repeated accept or claim. Such an answer changes nothing the refused fields asked for.
  - **Nothing changes on refusal.** A refused request changes nothing, including any valid fields sent with it. For example, a heartbeat carrying `muted`, `display_name` or `satchel_colour` is refused whole, and so is a profile edit carrying `balance` or `role`.
  - **Body shape.** A valid JSON body that isn't an object, or that nests objects and arrays more than 32 levels deep, fails with field `body`: `invalid`.
  - **Profile fields.** On `PATCH /api/me`, `satchel_id` is `satchel_id`: `invalid` when it isn't a JSON string or names no seeded satchel (for example `"gold"`). This is field validation (step 10 of the error precedence).
    - The ownership check (409 `not_owned`, step 9) exists only for a string that names a seeded satchel.
    - So an unknown or non-string id always answers 422 `invalid` and never `not_owned`.
    - A seeded satchel the courier doesn't own answers 409 `not_owned`.
  - **Position.**
    - A missing `position` is `position`: `required`. A `position` that isn't an object is `position`: `invalid`.
    - `lat`, `lon` and `heading_deg` must be finite JSON numbers. A string such as `"12"`, a boolean or null is `invalid`. A missing one is `required`. Each is named by path (for example `position.lat`).
    - `lat` runs from −90 to 90 and `lon` from −180 to 180, both inclusive. `heading_deg` is at least 0 and below 360, so 360 is `out_of_range`.
  - **Heartbeat fields.**
    - `stream` is 8 to 64 characters from A–Z, a–z, 0–9, `_` and `-`; anything else is `invalid`.
    - `seq` must be a whole JSON number. A fraction, a string or null is `invalid`, and a value below 1 or above 9,007,199,254,740,991 is `out_of_range`.
    - A missing `emote` means null. Any value other than the four emote names or null is `emote`: `invalid`.
- **Geometry.** Bramble is a sphere with the radius given in Seed data.
  - *Arc* is the shortest distance over the surface between two positions, in metres.
  - *Bearing* is the compass direction at the start of that shortest path, clockwise from north, rounded to a whole degree from 0 to 359.
  - *Compass label*: N for 338–359 and 0–22, NE for 23–67, E for 68–112, SE for 113–157, S for 158–202, SW for 203–247, W for 248–292, NW for 293–337.
  - A route's `total_arc_m` and `initial_bearing_deg` are measured from the accept or claim position to the door.
- **Route status values.** While a parcel is open, the client recomputes these from the courier's live position at least five times per second:
  - `data-arc-remaining-m` is the arc to the door, to one decimal.
  - `data-bearing-deg` is the bearing to the door.
  - `data-route-id` is the route id.
  - `data-ribbon-fraction` is the smaller of 1 and remaining arc ÷ total arc, to two decimals. Under reduced motion it rounds up to the next tenth, so "0.70" covers anything above 0.6 up to 0.7.
  - `data-ring-deg` equals the bearing, or stays 0 under reduced motion.
  - `data-door-screen` follows the camera every frame.
  - After a confirmed hand-over, the arc is "0.0" and the fraction "0.00".
  - The phase becomes `arrived` at an arc of 4 metres or less.
- **Door distance.** A hand-over succeeds only if its position is 4.0 metres or less, by arc, from the door of the accepted version. Otherwise it fails with 422 `position`: `too_far`.
- **Open parcels (DP-67).**
  - A courier carries at most one open parcel, standard or rush.
  - **Repeated accept.** An accept naming the mission of the courier's open standard parcel answers 200 with that Parcel byte for byte as its first 201 answer: the same `acceptance_id`, `version`, `reward_stamps`, `route_id`, `total_arc_m` and `initial_bearing_deg`, measured from the first accept's position. This holds even when a newer version has gone live or the mission has been retired since. It creates no acceptance.
  - **Repeated claim.** A claim naming the `rush_id` of the courier's open rush parcel, before its hold has lapsed, answers 200 with that Parcel byte for byte as its first 201 answer. `hold_expires_at` is identical to the millisecond, so re-claiming never extends a hold. Once the hold has lapsed, the same request is an ordinary claim (see Rush race).
  - **Hands full.** Any other accept or claim while carrying an open parcel fails with 409 `hands_full`. That covers accepting a different mission, accepting any mission while holding a rush parcel, and claiming any `rush_id` while holding a standard parcel or a different rush parcel.
  - **Where it sits.** This open-parcel check is the first state check (step 9) for accept and claim. It is decided before `mission_not_live`, `rush_claim_required`, `parcel_taken` and `board_closed`, and before the step-10 validation. So a repeat answers 200 even when its `position` is missing, malformed or carries unknown keys, and the position sent with a repeat is never used.
  - Standard missions can be repeated after delivery. Each acceptance is its own mission instance.
  - A parcel ends `delivered`, `dropped`, or (rush only) `expired`.
  - Dropping a closed parcel, including a lapsed rush parcel, fails with 409 `parcel_closed`.
  - Handing over a dropped parcel fails with 409 `parcel_dropped`.
- **Parcels are private to their courier (DP-60).** A drop or hand-over that names an acceptance belonging to another courier answers the fixed 404 body, whatever state that acceptance is in. The answer has the same status, the same body bytes and the same content type as for an id that never existed, for example `acc_0000000000000000`.
  - Such a request changes nothing: the owner's open parcel, hold, board row and ledger stay as they were, and no lapse is applied on the other courier's behalf.
  - In a hand-over, this 404 comes after the ticket checks. Errors are never stored, so the requester can use the same ticket on their own parcel afterwards.
  - No response a courier can read contains an `acceptance_id` other than their own.
- **Hand-over retries.** Every hand-over carries a `Handover-Ticket` chosen by the client.
  - **Scope.** The ticket is scoped to the courier and kept for at least 24 hours.
  - **What is stored.** Only a 201 is stored. It binds the ticket to the request body and stores the status and body.
  - **Replay.** Repeating a stored ticket with the same body returns the stored 201 byte for byte, including the original `balance`, and moves no stamps. This holds even after a rush hold has lapsed, because the replay comes before state conflicts in the error precedence.
  - **Conflict.** Reusing a stored ticket with a different body fails with 409 `ticket_conflict`.
  - **Refusals.** Error answers are never stored. A refused ticket is judged afresh on every repeat. For example, a ticket first answered `hold_expired` answers `hold_expired` again and moves no stamps.
  - **New ticket, delivered parcel.** A new ticket for an already delivered parcel fails with 409 `already_delivered`.
  - **Simultaneous repeats.** If two requests with the same ticket arrive together, both get the same 201 body, and only one delivery exists.
  - **Once per instance.** A mission instance is delivered at most once.
- **Purchase tickets (DP-59).** Every buy carries a `Purchase-Ticket`.
  - **Scope.** The ticket is scoped to the courier, kept for at least 24 hours, and lives in its own namespace, separate from hand-over and mail tickets.
  - **What is stored.** Only a 201 is stored, bound to the `satchel_id` in the path.
  - **Replay.** Repeating a stored ticket on the same `satchel_id` returns the stored 201 byte for byte, including the original `balance` even if the balance has changed since. It writes no movement.
  - **Conflict.** Repeating it on a different `satchel_id` fails with 409 `ticket_conflict`.
  - **Refusals are never stored.** For example, a ticket first refused with `insufficient_stamps` succeeds later once the balance covers the price.
  - **New ticket, owned satchel.** A new ticket for a satchel already owned fails with 409 `already_owned`.
  - **Simultaneous repeats.** Requests with the same ticket that arrive together all get the same 201 body, and exactly one purchase movement exists.
- **Mail tickets (DP-77).** Every postcard mail carries a `Mail-Ticket`.
  - **Scope.** The ticket is scoped to the courier, kept for at least 24 hours, and lives in its own namespace, separate from hand-over and purchase tickets.
  - **What is stored.** Only a 200 is stored, together with its `sent_at` (the moment the mail server accepted the message), bound to the `postcard_id` in the path and to the `to` string exactly as sent.
  - **Replay.** Repeating a stored ticket with the same `postcard_id` and `to` returns the stored 200 byte for byte, including the original `sent_at`. It sends no email and uses no mail slot. Because it is step 5 of the error precedence, it wins over a 404 (for example a postcard revoked since), a 429 and a 503.
  - **Conflict.** Repeating it with a different `postcard_id` or a different `to` fails with 409 `ticket_conflict`.
  - **Refusals are never stored.** 404, 422, 429 and 503 answers leave the ticket absent, so a ticket first refused with `mail_limit` succeeds later once a slot frees.
  - **In flight.** A request arriving while another request with the same ticket is still being handled waits for it. If the first is stored, the waiting request answers the stored 200; if the first failed, the waiting request is judged afresh. So N simultaneous requests with one ticket give N identical 200 bodies, one email and one slot.
- **Stamp ledger.**
  - Each stamp movement writes exactly two entries. They share a `movement_id` and sum to zero:
    - a delivery writes `courier` +reward and `mint` −reward;
    - a purchase writes `courier` −price and `outfitter` +price.
  - A movement's `created_at` is the moment it commits.
  - A courier's balance is always the sum of their `courier` entries, and every balance the API returns or the screen shows is that sum.
  - Entries are never edited or deleted. A correction is a new reversing movement.
  - A satchel priced at 0 writes no movement.
  - A purchase that would take the balance below zero fails with 409 `insufficient_stamps`. When different purchases arrive together, only those the balance covers succeed.
  - Rush claims, drops and expiries move no stamps.
- **Stamp history paging.**
  - **Order.** `GET /api/me/ledger` returns the caller's movements newest first, by `created_at` descending, then by `movement_id` descending.
  - **Page size.** `limit` counts movements, not entries. Each movement carries both of its entries, so a page never splits a pair.
  - **Balance.** Every page's `balance` is the courier's whole ledger sum at the time of that read, never a sum over the page.
  - **Next cursor.** `next_cursor` is an opaque string pointing just past the last movement on the page. It is `null` when no older movement exists at the time of the read.
  - **Walking the pages.** Passing a cursor as `before` returns the movements strictly older than that point. While new deliveries or purchases are made during a walk through the pages, no movement appears twice and none is skipped. Movements created after the first page was read never appear on later pages.
  - **Cursor binding.** A cursor works only for the courier who received it. A cursor that is malformed, altered in any character, or issued to another courier fails with 422 `before`: `invalid`.
  - **Limit errors.** A `limit` that isn't a whole number (for example `abc` or `2.5`) is `limit`: `invalid`. A whole number below 1 or above 50 is `limit`: `out_of_range`.
- **Postbox keys.**
  - **Same answer either way.** A well-formed request always triggers the same work, whether or not a courier owns the email: the server creates a single-use key and sends the email.
    - Known and unknown addresses get the same status and body.
    - Their median response times are within 100 milliseconds of each other.
    - When the mail server is unreachable, both get the same 503.
  - **Return path (DP-73).** `return_to` is optional; a missing `return_to` means `/`. When sent it must be a JSON string equal, character for character, to exactly one of:
    - `/`
    - `/console`
    - `/console?mission=new`
    - `/console?mission=<id>`, where `<id>` is 1 to 64 characters from a–z, 0–9 and `-`.

    A value that isn't a string (null included) is `return_to`: `invalid`; a string over 200 characters is `too_long`; any other string outside that list is `invalid`. For example `//evil.example`, `/\evil.example`, `\/evil.example`, `https://evil.example`, `/%2F%2Fevil.example`, `javascript:alert(1)`, `/console?mission=x&next=//evil.example`, `/console#x`, `/Console` and any value holding a control character are all `invalid`. A refused request creates no key and sends no email.
  - **What the key keeps.** The key stores its `return_to`. The email carries the claim link and nothing derived from `return_to` (Services). `POST /api/auth/redeem` returns the stored value as `return_to` and nothing else decides where the claim page leads.
  - **Lifetime.** A key lasts `POSTBOX_KEY_TTL_SECONDS` seconds from its request (default 900; it may be set as low as 5). It is still valid at exactly that age and expired from any later moment, judged by the server clock when the redeem is processed.
  - **Redeeming.** Redeeming a key signs the caller in as the courier for that email. The courier is created with role `courier` on first use.
  - **Refusals.** A reused key fails with 410 `link_used`, an expired one with 410 `link_expired`, and one that never existed with 410 `link_invalid`.
  - **Simultaneous redeems.** When the same key is redeemed twice at once, exactly one succeeds.
- **Sessions rotate (DP-66).**
  - **Redeem.** Every successful redeem sets a new `pm_session` value and ends the session the browser held before, whether that was a guest or a courier session. From then on, the old cookie value answers 401 `unauthenticated` on every endpoint that needs a session.
  - **Sign-out.** It ends the session on the server. The signed-out cookie value answers 401 everywhere a session is needed, and `POST /api/guest` sent with it answers 201 with a new guest.
  - **Carried over.** On a redeem, the browser's latest heartbeat and its presence streams move to the new session in the same step.
- **Claiming a guest save.** A guest save *has progress* when it has any movement, any satchel other than the starting Canvas Satchel, or an open parcel. The Canvas Satchel every courier starts with never counts toward this test.
  - **When it merges.** If the redeeming browser holds a guest session whose save has progress, that save merges into the courier once and is then marked claimed.
  - **No progress.** A guest save without progress never merges. Its redeem answers `merged_guest: false` and `merge_report: null`. A courier it creates gets a fresh `Courier <four random digits>` name and wears the Canvas Satchel.
  - **What carries over:**
    - Every guest movement moves to the courier with its original `movement_id` and `created_at`. So it is placed by time among the courier's own movements in stamp history, and appears exactly once.
    - Owned satchels are combined.
    - When a save merges, a new courier takes the guest's display name and worn satchel. An existing courier keeps their own.
    - The guest's open parcel moves over if the courier has none, keeping its `acceptance_id` and first answer, so a repeated accept from the claiming browser returns it. Otherwise it is dropped.
    - The guest's stored hand-over, purchase and mail tickets move to the courier. Where the courier already stored the same ticket value in the same namespace, the courier's entry wins and the guest's is discarded. So a retry from the claiming browser of a purchase made as a guest replays the guest's original 201.
  - **Merge report.** On the redeem that merged, `merged_guest` is `true` and `merge_report` is `{"movements":<number of movements moved>,"satchels_added":[<satchel_id the courier didn't already own>],"parcel":"moved|dropped|none","name_kept":"guest|courier"}`. A claimed guest save never merges again.
  - **Next visit.** Signing out ends the session, and the next visit starts a new guest.
- **Display names (DP-26, DP-69).**
  - **Checks on save, in this order:**
    1. A `display_name` that isn't a JSON string, or a string holding a lone surrogate (a `\uD800`–`\uDFFF` escape without its partner), is `display_name`: `invalid`, and nothing changes.
    2. **Fold.** Every run of one or more of these characters becomes one space: White_Space characters (including carriage return, line feed, tab and the line and paragraph separators), general categories Cc, Zl and Zp, and the direction controls U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069.
    3. **Trim** leading and trailing spaces.
    4. **Normalise** to NFC.
    5. **Count** Unicode code points: 0 is `required`, more than 24 is `too_long`. Exactly 24 is allowed.
  - **Examples:**
    - 24 fox emoji "🦊" are accepted; 25 are `too_long`.
    - 24 × "e" followed by U+0301 is stored as 24 × "é" and accepted.
    - "Wren" + U+202E + "evil" is stored as "Wren evil".
    - "Wren\r\nBcc: x@example.com" is stored as "Wren Bcc: x@example.com".
  - **Generated names.** A guest, or a force-renamed courier, gets `Courier <four random digits>`.
  - **Stored form everywhere.** Me, presence, the staff view, the postcard page caption (escaped as HTML) and the postcard email all show the stored NFC string, exactly.
  - **Names are read live.** Wherever a courier's name appears, it is the courier's stored display name at the moment of that read, view or send, never a copy taken earlier. The only exception is the moderation audit snapshots.
- **Studio time zone and board day.**
  - **Accepted zones.** The studio time zone is matched letter case and all against the accepted set, which is the union of:
    - every name that Node.js 22's built-in Intl time zone list reports as supported;
    - `UTC`;
    - these names, which are always accepted even where Node's list spells the same zone differently (for example as `Asia/Katmandu` or `Asia/Calcutta`): `America/Vancouver`, `America/St_Johns`, `Europe/London`, `Asia/Kolkata`, `Asia/Kathmandu`, `Australia/Adelaide`, `Australia/Eucla`, `Australia/Lord_Howe`, `Pacific/Chatham`.

    Anything else is 422 `time_zone`: `invalid` and changes nothing. Examples: `Mars/Olympus`, `+05:30`, `UTC+3`, `america/vancouver` or an empty string. The response's `time_zone` is the name exactly as accepted. The checks use only the named zones above and zones that appear in Node's own list.
  - **Board date.** Take the current local wall-clock date and time in the studio time zone. If the local time is 04:00:00.000 or later, the board date is that local date. Otherwise it is the previous local date.
    - The boundary is always the local wall clock, never "now minus four hours". On daylight-saving change days, a board day therefore lasts 23 or 25 hours.
    - Half-hour and 45-minute offset zones follow the same rule.
  - **Agreement.** `GET /api/depot`, `GET /api/founder/studio`, the console's "Today's board" and the Depot heading always agree. A zone change applies from the very next read. A refused change leaves the board date unchanged.
  - **Posting.** The first read of a board date posts `rush_slots` parcels for every live rush mission, exactly once, even when reads arrive together. A rush mission that goes live posts its slots on the current board at that moment.
  - **Revisiting dates.** A board date seen again, for example after switching zones back, shows its original parcels.
  - **Earlier dates.** Parcels from earlier board dates are not listed, and claiming one fails with 409 `board_closed`. A claim already held from an earlier date can still be handed over until its hold ends.
  - **Retiring.** Retiring a rush mission removes its posted, unclaimed parcels from the board. Held claims continue; a held parcel of a retired mission that lapses or is dropped is removed from the board rather than posted again, and claiming it fails with 409 `mission_not_live`.
  - **Slot changes.** A `rush_slots` change takes effect on the next board day.
- **Rush parcel numbers (DP-74).**
  - When a mission's parcels are posted on a board date, they are numbered `slot` 1 to `rush_slots`, and every one of them carries `slots` equal to that count.
  - A parcel keeps its `slot` and `slots` for its whole life: through claims, drops, lapses and re-claims, through a same-day `rush_slots` edit and through a retire.
  - Rows are ordered by `mission_id`, then `slot`. Every Claim button's name on one board is therefore unique.
  - Claims on different parcels of one mission never block each other: simultaneous claims on different `rush_id`s each win with 201.
- **Rush race.** A rush parcel moves posted → claimed → delivered, or claimed → expired → posted, or claimed → dropped → posted.
  - **One winner.** When claims on the same parcel arrive together, exactly one wins with 201. Every other claimant gets 409 `parcel_taken` and holds nothing.
  - **What others see.** A claimed parcel with an unlapsed hold, or a delivered parcel, reads `taken` to everyone except its claimant. From the moment a hold lapses, the parcel reads `posted` to everyone, including the lapsed courier, until someone claims it again.
  - **Hold end.** `hold_expires_at` is the claim's commit moment plus `RUSH_HOLD_SECONDS` seconds (default 600; it may be set as low as 4).
  - **Expiry is judged per request.** The server clock decides expiry at the moment each request is processed, whether or not any background work has run. A hold has lapsed when that moment is at or after `hold_expires_at`.
  - **Hand-over timing.**
    - A hand-over processed before `hold_expires_at`, within the door distance, succeeds.
    - One processed at or after `hold_expires_at` fails with 409 `hold_expired` and moves no stamps, even if storage still shows the parcel as claimed.
    - A stored 201 still replays, as set out in Hand-over retries.
  - **Claiming a lapsed parcel.** A claim on a parcel whose hold has lapsed is treated as a claim on a posted parcel and wins with 201 under the one-winner rule, with a new `acceptance_id` and a new hold, including when the claimant is the courier whose hold lapsed.
    - The lapsed acceptance becomes `expired` in the same transaction.
    - The parcel returns to the board exactly once: there is one `expired` acceptance and one new claim, and the board never lists that `rush_id` twice.
  - **The lapsed courier.** From the lapse onward, on any of that courier's own requests:
    - `GET /api/me` shows `open_parcel: null`;
    - their drop fails with 409 `parcel_closed`;
    - a new accept or claim is no longer refused with `hands_full`;
    - their depot row reads `posted`, or `taken` once someone else has claimed it.
  - **Dropped claims.** A dropped claim returns the parcel to `posted` at once, exactly once.
  - **Rush count (DP-12).** `rush_left` is the number of today's rush parcels a claim could win at the moment of the read: those posted, plus those claimed with a hold that has lapsed by the server clock, leaving out parcels of retired missions.
    - It is the same number for every caller, and equals the number of rows reading `posted` to a courier who holds none of today's rush parcels. A holder's own `yours` row is never counted.
    - It moves from the very next read on a claim, a drop, a lapse, a retire (its posted parcels go) and a rush mission going live (its slots are added), with no background job needed.
- **Mission lifecycle.** Only the founder moves missions. The legal moves are:
  - draft → scheduled (`schedule`), when the resolved go-live instant is inside the scheduling window and later than the server's clock at the moment the request is processed;
  - draft → live (`schedule`, "Publish now"), when the resolved instant is at or before the server's clock at the moment the request is processed. This is a single move made inside that request: the answer is 200 with status `live`, `live_at` set to the resolved instant and the revision raised by exactly 1. The value `"now"` resolves to the server's clock at processing, so it always takes this path;
  - scheduled → draft (`unschedule`);
  - scheduled → live, automatically when the server clock reaches `live_at`, reported by the API within one second;
  - live → retired (`retire`).

  Every other move, including any move out of retired, fails with 409 `illegal_transition`. Only live missions can be accepted or posted. Anything else fails with 409 `mission_not_live`.
- **Scheduling in studio time (DP-62).**
  - **Body.** The schedule body carries exactly one of:
    - `live_at`, an ISO 8601 instant with an explicit offset or `Z`, or the string `"now"`;
    - `live_at_local`, a wall time `YYYY-MM-DDTHH:MM` in the current studio time zone, with no seconds and no offset.

    Both keys at once is `live_at_local`: `invalid`. Neither is `live_at`: `required`.
  - **Check order.** Checks run in this order on the key that was sent: the format (`invalid`); then, for `live_at_local` only, a skipped time (`nonexistent_time`); then the window on the resolved instant.
  - **Skipped times.** A local time that doesn't exist because the clocks jump forward is `nonexistent_time`, and the mission stays as it was. For example:
    - America/Vancouver 2027-03-14 02:30;
    - Australia/Lord_Howe 2027-10-03 at any minute from 02:00 to 02:29, a 30-minute jump.
  - **Repeated times.** A local time that happens twice, because the clocks fall back, resolves to the earlier instant, the one using the offset from before the change. For example:
    - America/Vancouver 2026-11-01 01:30 resolves to `2026-11-01T08:30:00.000Z`;
    - Australia/Lord_Howe 2027-04-04 01:45 resolves to `2027-04-03T14:45:00.000Z`.
  - **Ordinary times.** Every other local time maps to its single instant, including in 45-minute zones such as Asia/Kathmandu.
  - **Window.** The resolved instant may be at most 60 seconds before now (`in_past` beyond that) and at most 366 × 86,400 seconds after now (`out_of_range` beyond that). Both limits are allowed.
  - **Stored instant.** The stored `live_at` is the resolved instant. It never moves when the studio zone later changes. The Goes live cell re-renders that same instant in the new zone.
- **Mission versions.**
  - **Edits.** Editing a draft or scheduled mission changes it in place at version 1. Each edit to a live mission creates version n+1, which goes live at once for new acceptances and new rush claims.
  - **Earlier versions.** A courier holding an earlier version gets that version's door, reward and thanks lines on hand-over, even after the mission is retired.
  - **Refused edits.** Editing a retired mission fails with 409 `mission_retired`. `kind` is fixed at creation.
  - **Rush version rule.**
    - A rush parcel is posted without a version.
    - Claiming it binds the mission's latest live version at that moment. The claim's Parcel and its hand-over use that version's `version`, `reward_stamps`, door, offer and thanks lines.
    - On the board, a `posted` row shows the latest live version and its reward. A `taken`, `yours` or `delivered` row shows the version bound by its claim.
    - A parcel back at `posted` after an expiry or drop is unbound again.
- **Mission revisions (DP-64).**
  - **Rising by 1.** A mission's `revision` starts at 1 and rises by exactly 1 on every successful founder change (edit, schedule, Publish now, unschedule, retire) and on the automatic scheduled → live move.
  - **If-Match.** `PATCH`, `schedule`, `unschedule` and `retire` require `If-Match: "<revision>"`.
    - Missing, it fails with 428 `precondition_required`.
    - Any value other than the current revision in double quotes fails with 412 `stale_revision`, carrying the current `ETag`. Nothing changes.
  - **Simultaneous edits.** When edits carrying the same revision arrive together, exactly one succeeds and the others get 412. An edit to a live mission therefore adds exactly one version.
  - **Console.** A clean editor (no unsaved edits) takes the new revision on each refresh, so an edit made after watching a mission go live saves first time. An editor with unsaved edits keeps the revision it loaded.
- **Mission fields.** On create every key is required. On edit only the keys sent are checked, and `rush_slots` is checked against the mission's stored kind. Each faulty field gets exactly one reason, the first that applies in the order given for it:
  - `title`, a string of 1 to 60 characters with no line breaks: missing → `required`; not a string, or containing a line break → `invalid`; the empty string → `required`; over 60 characters → `too_long`.
  - `reward_stamps`, a whole number from 1 to 50: missing or null → `required`; not a whole JSON number (for example `2.5` or `"5"`) → `invalid`; below 1 or above 50 → `out_of_range`.
  - `resident_id`: missing → `required`; not a string → `invalid`; not a seeded resident → `unknown_resident`.
  - `kind`: missing → `required`; anything other than `standard` or `rush` → `invalid`; sent on an edit → `fixed_after_create`.
  - `rush_slots`: missing → `required`. For a rush mission: null → `required`; not a whole JSON number → `invalid`; below 1 or above 5 → `out_of_range`. For a standard mission: any value other than null → `invalid`.
  - `dialogue`: missing → `required`; not an object → `invalid`.
  - `dialogue.offer` (1 to 6 lines) and `dialogue.thanks` (1 to 3 lines), each line a string of 1 to 200 characters with no line breaks, reported on the list's path: missing → `required`; not an array of strings, or any line containing a line break → `invalid`; too few or too many lines → `out_of_range`; any empty line → `required`; any line over 200 characters → `too_long`.
- **Presence.** Each page that is visible sends a heartbeat and reads presence once a second.
  - **Streams and sequence numbers.** Each page load picks its own random `stream` and numbers its heartbeats `seq`, starting at 1 and rising by 1 with each heartbeat.
    - The server remembers the highest accepted `seq` for each stream of a session, for at least 60 seconds after that stream's last heartbeat.
    - A heartbeat whose `seq` is not higher than its stream's highest is stale: it stores nothing, no position and no emote. It answers 200 with `accepted: false`, the stream's highest `seq` as `last_seq`, and the courier's current emote and mute state as others see them.
    - An accepted heartbeat answers `accepted: true` with its own `seq` as `last_seq`.
  - **Who is online.** A courier is online when any of their live sessions has an accepted heartbeat no more than 15 seconds old.
  - **Listing.** `GET /api/presence` lists each online courier exactly once, leaving out the caller's own courier across all its sessions. An entry's position is the courier's most recently accepted heartbeat, by server receive order, from any of their live sessions or streams.
  - **Entry fields.** Each entry carries exactly `display_name`, `satchel_colour`, `position` and `emote`.
    - `display_name` and `satchel_colour` always come from the stored name and the worn satchel at read time, never from a heartbeat.
    - Account ids, emails, balances, roles and the moderation reference never appear in an entry.
  - **Emotes.** An accepted heartbeat carrying an emote stores it for the courier, replacing any earlier one, and its 4-second window starts at that heartbeat's receipt. A stored emote shows on the entry until its window ends. An accepted heartbeat whose `emote` is null or missing leaves a stored emote in place until its window ends; it never clears it early.
  - **Delay.** A courier's own changes reach other couriers within 3 seconds.
  - **Leaving at once (DP-70).**
    - Sign-out deletes that session's heartbeats and streams in the sign-out step. From the next read by anyone (presence, the staff view and Online now), the courier is listed only if another of their live sessions has a fresh accepted heartbeat, and then exactly once, at the newest heartbeat among the remaining sessions, never the signed-out session's.
    - A heartbeat sent with a signed-out or replaced cookie answers 401 and stores nothing.
    - From the next read after a redeem, the guest courier appears nowhere, and the signed-in courier appears exactly once, under its stored name, at the browser's moved latest heartbeat. The guest and the courier never appear as two entries.
    - The 15-second freshness rule still applies to couriers who simply stop sending heartbeats.
  - **Staff view.** It lists the same couriers, one entry each, and adds only `moderation_ref`, `muted` and `name_locked`. `moderation_ref` is an opaque value that differs from every other identifier the API returns.
- **Mute and rename.**
  - **Mute.** Muting clears the courier's stored emote in the same transaction as the mute. From the very next presence or staff read, by anyone, the courier's `emote` is null, even for an emote sent a moment before the mute.
  - **Heartbeats while muted.** A muted courier's heartbeat stores no emote and answers with `emote: null` and `muted: true`.
  - **Unmute.** Unmuting never brings an emote back. An emote sent before or during the mute stays hidden, even inside its 4-second window. Only an emote sent after the unmute shows.
  - **Rename.** It sets a fresh `Courier <four random digits>` name and locks it.
    - From the next read, every presence entry, the staff view and every share page show the new name, and the old name appears nowhere in them.
    - After a rename, the courier's own name changes fail with 403 `name_locked`.
  - **What stays the same.** Mute, unmute and rename leave position and satchel colour unchanged. A muted courier keeps walking and delivering.
  - **Repeats and races.**
    - Muting a muted courier fails with 409 `already_muted`. Unmuting one who isn't muted fails with 409 `not_muted`. Neither writes an audit entry.
    - When a helper and the founder mute the same courier at the same moment, exactly one gets 200 and the other 409 `already_muted`, and exactly one audit entry is written. Simultaneous unmutes behave the same way with `not_muted`.
    - A rename always succeeds and writes an entry.
- **Moderation audit.**
  - Every successful mute, unmute and rename writes exactly one entry, in the same transaction as the action.
  - `actor_role`, `actor_display_name`, `target_name_before` and `target_name_after` are snapshots taken at that moment. Later renames of the actor or the target never change existing entries.
  - For a mute or unmute, `target_name_before` equals `target_name_after`.
  - Entries are only ever added. None is edited or deleted, and the audit paths accept only GET.
- **Online now.**
  - **Counts.** `online` counts distinct online couriers, never sessions, streams or tabs. `guests` counts online couriers with role `guest`. `signed_in` counts online couriers with role `courier`, `helper` or `founder`.
  - **Agreement.** Every read has `online = guests + signed_in`. Muted and renamed couriers still count. `online` equals the number of entries in the founder's `GET /api/presence`, plus 1 when the founder is online.
  - **Redeem.** A redeem, merging or not, moves that browser's latest heartbeat from the guest to the courier's new session in the same step that signs it in. From the next read, that browser counts only as signed in, never as both.
  - **Sign-out.** Sign-out removes that session's heartbeats at once, as in Leaving at once. A courier with another fresh session still counts once. The new guest from the next visit counts only after its first accepted heartbeat.
- **Roles.**
  - **Founder only.** The founder alone creates, edits, schedules, unschedules and retires missions, changes stamp rewards, sets the studio time zone and reads Online now.
  - **Moderators.** Helpers and the founder mute, unmute and rename couriers whose role is `guest` or `courier`. Moderating a helper or the founder fails with 403 `cannot_moderate_staff`.
  - **Server-enforced.** The server enforces every refusal in the API table, whatever the client shows.
  - **Stamps.** No role can change anyone's stamps directly.
- **Postcard image checks.** A PNG is an 8-byte signature followed by chunks. Each chunk has a 4-byte big-endian length, a 4-byte type, its data, and a CRC-32 over the type and data. Before anything reaches the store, the server walks every chunk up to and including the first `IEND`. The first failed check, in this order, decides the reason:
  1. `not_png`, if any of these is true:
     - the body doesn't start with the signature;
     - the first chunk isn't `IHDR` with length 13, or a second `IHDR` appears;
     - a chunk's length runs past the body;
     - a chunk type byte is outside A–Z and a–z;
     - a CRC-32 is wrong;
     - a critical chunk (type starting with an upper-case letter) other than `IHDR`, `PLTE`, `IDAT` or `IEND` appears;
     - there is no `IDAT` chunk, or the `IDAT` chunks aren't consecutive;
     - there is no `IEND` chunk;
     - the `IHDR` bit depth and colour type aren't a legal pair. The legal pairs are: greyscale with 1, 2, 4, 8 or 16; truecolour with 8 or 16; indexed with 1, 2, 4 or 8; greyscale with alpha with 8 or 16; truecolour with alpha with 8 or 16;
     - the compression method or filter method isn't 0, or the interlace method isn't 0 or 1;
     - `PLTE` breaks any of these rules: it must be present for indexed colour and absent for greyscale and greyscale with alpha; it may appear only once and before the first `IDAT`; its length must be a multiple of 3 from 3 to 768.
  2. `trailing_data`: any byte follows `IEND`.
  3. `animated`: an `acTL`, `fcTL` or `fdAT` chunk is present.
  4. `bad_dimensions`: the width or height is outside 320 to 2048 pixels inclusive.
  5. `bad_image_data`, if any of these is true:
     - the joined `IDAT` data isn't one complete zlib stream;
     - the stream doesn't inflate to exactly the expected size;
     - a scanline's filter byte is above 4.

     The channel counts are: greyscale 1, truecolour 3, indexed 1, greyscale with alpha 2, truecolour with alpha 4. For a non-interlaced image, the expected size is height × (1 + ⌈width × channels × bit depth ÷ 8⌉). For an interlaced image, it is the same sum taken over each of the seven interlace passes that has at least one row and one column. Inflation stops one byte past the expected size, so an oversized stream costs no more than that.

  Every rejection is 422 with field `image` and that reason. No object is written for a rejected upload, not even briefly, and the postbox list doesn't change. The client's 1200 by 800 capture passes, because its stamp edge and postmark are pixels, never extra chunks.
- **Postcards.**
  - **Cap.** A courier keeps at most 24 postcards. A 25th fails with 409 `postbox_full`.
  - **Upload.** After the checks pass, the server stores the image, then writes the record. If the record can't be written, it removes the image before answering.
  - **Revoke.**
    - The server first marks the record revoked. From then on, the postcard is unlisted, doesn't count toward the 24, and its page and image answer 404.
    - Then it removes the image, then the record, and answers 204.
    - If the image can't be removed, the mark is lifted and the 503 is returned. The postcard, its listing and its link stay exactly as they were.
    - If the record can't be removed after its image is gone, the revoke still answers 204. The record stays hidden and is removed within 60 seconds.
  - **Clean-up.** Any image older than 60 seconds with no record is removed within 60 seconds of the store being reachable.
  - **Invariant.** No listed postcard or working share link ever points at a removed image. Once every postcard request has answered and these clean-ups have run, a postcard record exists exactly when its image exists.
  - **Share tokens.** Each share token is at least 32 URL-safe characters, carries at least 128 bits of randomness and is unrelated to `postcard_id`. `share_url` is `<base>/p/<share_token>`. A share link only reads, and after a revoke the page and image answer 404 at once.
- **What postcard copies may carry.**
  - **The public page.** Its HTML holds the heading, the caption with the live display name, page styling, and one image whose source is the relative path `/p/<share_token>/image.png`.
  - **The postcard email.** Its plain-text part is exactly the line in Services. Any HTML part holds only that same sentence and the share link.
  - **Never in a copy.** No page, image response, email header or email part contains any of the following, including in attributes such as alt text and `data-` attributes:
    - the sender's email;
    - any courier, account, session, acceptance, delivery or postcard id;
    - the moderation reference;
    - the store's address, as defined under Nothing describes the machinery in Server boundary;
    - the bucket name, an object key or a store ETag;
    - a presigned or direct store URL.
- **Postcard mail limit.**
  - **Window.** A courier's sends count across all their postcards and sessions over a rolling window of `POSTCARD_MAIL_WINDOW_SECONDS` seconds (default 600; it may be set as low as 20). At most 5 count in any window.
  - **Refusal.** A send made while 5 already count fails with 429 `mail_limit` and sends nothing. Its `Retry-After` is the number of whole seconds until the oldest counted send leaves the window, rounded up, with a minimum of 1.
  - **What counts.** Only sends answered with a fresh 200 count; a ticket replay never counts and never moves the window. Answers of 404, 422, 429 and 503 use no slot. For example, while the mail server is unreachable, a courier's sixth and later sends in one window still answer 503 and never 429, because failed sends hold no slot.
  - **Concurrency.** A send reserves its slot in the same transaction that checks the count. When N sends with different tickets arrive together and r slots remain, exactly the smaller of N and r succeed and the rest get 429. A slot whose mail then fails to reach the mail server is released before the 503 is returned.
  - **Timing.** A send's place in the window is measured from its reservation.

### Services (DP-09, DP-21, DP-24, DP-25, DP-26, DP-27, DP-46, DP-49, DP-69, DP-73, DP-77)

`<base>` is `APP_PUBLIC_URL` without a trailing slash, or `http://localhost:<port>` when it is unset.

- **Postgres** (`DATABASE_URL`) is the source of truth for:
  - couriers, guest saves, sessions and postbox keys with their stored return path;
  - ledger entries;
  - missions with their versions and revisions;
  - studio settings, board days, rush parcels with their slot numbers and posted counts, and holds;
  - acceptances with their first answers, and deliveries;
  - hand-over, purchase and mail tickets;
  - presence stream positions;
  - postcard records, postcard mail slots and the moderation audit.

  The schema is applied on every start in a way that is harmless when it already exists. Presence is either never written to the database, or kept in rows that are removed once they are 60 seconds old. A mute clears the stored emote in the mute's own transaction, and a sign-out removes its session's heartbeats in the sign-out's own step.
- **Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`, no authentication).
  - **Postbox key email.**
    - To: the requested address.
    - From: `MAIL_FROM` (`Parcel Moon <postbox@kitefold.example>`).
    - Subject: `Your Parcel Moon postbox key`.
    - The plain-text body contains `<base>/claim?token=<token>` exactly once and never the `return_to` value.
    - It must arrive within the key's lifetime.
  - **Postcard email.**
    - To: exactly one recipient, the `to` address.
    - From: the display name `<display_name> via Parcel Moon` with the address `postcards@kitefold.example`.
    - Envelope sender (Return-Path): `postcards@kitefold.example`.
    - Subject: `<display_name> sent you a postcard from Bramble`.
    - Plain-text body: `<display_name> took this postcard on Bramble: <share_url>`.
    - It has no `Reply-To`, `Sender`, `Cc` or `Bcc` header.
    - **Header encoding.** Every header line is ASCII only and at most 998 octets long. Non-ASCII text in the From display name or the Subject is sent as RFC 2047 UTF-8 encoded-words. Commas, angle brackets and quotes in a name stay inside the From display name. Decoded, the From display name is exactly `<display_name> via Parcel Moon` and the Subject exactly `<display_name> sent you a postcard from Bramble`, so a name can never add a header, a recipient or a line.
    - `<display_name>` is the sender's stored name at the moment of sending. Mail already sent is never changed.
    - Exactly one message is sent per stored mail ticket.
  - **No other mail.** Deliveries, rush wins, purchases and moderation send no mail.
  - **When SMTP is unreachable,** both mail endpoints answer 503 `{"error":{"code":"post_office_closed","message":"The post office is closed."}}` and nothing is queued. `GET /api/status` reports `post_office: closed`.
- **MinIO** (the `S3_*` variables).
  - **Storage.** Each postcard is stored in the bucket `S3_BUCKET` under `postcards/<postcard_id>.png`, as `image/png`, byte for byte as uploaded. `postcard_id` is `pc_` followed by at least 16 lowercase letters or digits.
  - **One bucket.** The app uses only that bucket and never creates others.
  - **When the store is unreachable,** upload, revoke and the share image answer 503 `{"error":{"code":"darkroom_closed","message":"The darkroom is closed."}}`, and `GET /api/status` reports `darkroom: closed`. Listing postcards, the public page itself and all play keep working.

### Seed data (DP-03, DP-05, DP-07, DP-08, DP-12, DP-34, DP-48, DP-74)

Every person, resident and business below is invented. The seed is applied once, on the first start against an empty database, and never overwrites changes.

- **Bramble:** radius 60 metres. Bramble Depot is at lat 0, lon 0, and couriers spawn there facing north.
- **Residents:**

| resident_id | name | home | door lat, lon |
|---|---|---|---|
| `ottoline` | Ottoline Fennick | Lantern Mill | 30, 45 |
| `barnaby` | Barnaby Sorrel | Gourd House | −20, 110 |
| `pim` | Pim Halloway | Tide Observatory | 60, −80 |
| `juniper` | Juniper Okafor | Mossy Arch | −45, −150 |

- **Missions** (all at version 1 and revision 1):

| mission_id | title | resident | reward | kind | status | offer lines | thanks lines |
|---|---|---|---|---|---|---|---|
| `lantern-oil` | Lantern oil for the mill | ottoline | 5 | standard | live | "The mill lamps are sputtering again." / "Bring me a tin of lantern oil from the depot, would you?" | "Bright as noon. Here, take these stamps." |
| `seed-packets` | Seed packets for the gourds | barnaby | 4 | standard | live | "My gourds want company." / "Fetch the seed packets with the blue string." | "They'll be climbing the fence by spring." |
| `star-chart` | A rolled star chart | pim | 8 | standard | live | "The tide charts are fine, but the star charts are late." / "Mind the tube — it's older than the observatory." | "Perfect. Tonight we count comets." |
| `moonmelon-express` | Moonmelon Express | juniper | 15 | rush (1 slot) | live | "A moonmelon is only sweet for an hour." / "Run it to Mossy Arch before it sulks!" | "Still cold! You're the fastest on Bramble." |
| `kite-string` | Kite string for the mill | ottoline | 6 | standard | draft | "The wind finally turned." / "I need the long spool of kite string." | "Up she goes. Thank you, courier." |

- **Satchels** (each satchel's `colour` equals its `satchel_id`):
  - `canvas`, Canvas Satchel, 0 stamps. Every courier owns and wears it from the start.
  - `riso-pink`, Riso Pink Satchel, 12 stamps.
  - `sunpatch`, Sunpatch Satchel, 20 stamps.
  - `night-ink`, Night Ink Satchel, 35 stamps.
  - `tidewater`, Tidewater Satchel, 50 stamps.
- **Couriers:**

| person | email | display name | role | balance |
|---|---|---|---|---|
| Wren Ashdown | `wren@kitefold.example` | Wren | founder | 0 |
| Odile Marsh | `odile@kitefold.example` | Odile | helper | 0 |
| Tamsin Reyes | `tamsin@example.com` | Tamsin | courier | 23, from two paired delivery movements: `star-chart` 8, then `moonmelon-express` 15 one second later |
| Ravi Lindqvist | `ravi@example.com` | Ravi | courier | 0 |

  At start nobody has an open parcel, a postcard, a mail send, a stored ticket or an audit entry, and there are no guest saves.
- **Studio time zone:** `America/Vancouver`.
- For example, with the seed data at start:
  - Accepting `lantern-oil` at the depot gives a total arc of 54.7 metres and an initial bearing of 51°, and the route readout reads "Bearing NE 51°, 55 m".
  - The first depot read of the day shows `rush_left` 1, one rush row with `slot` 1 and `slots` 1, the heading "Rush board · <board_date> · 1 left" and the button "Claim Moonmelon Express, parcel 1 of 1".
  - Tamsin's Stamp history shows "+15 stamps · Delivery" above "+8 stamps · Delivery".
  - A guest who delivers `star-chart` and `lantern-oil` has 13 stamps and, after buying the Riso Pink Satchel, 1.

## Technical requirements

### Deployment (DP-39)

- Node.js 22 with npm is available. The app is written in TypeScript.
- `/app/run.json` holds string commands for `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:
  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- The serve command listens on `0.0.0.0`, on port `APP_PUBLIC_PORT` when it is set and otherwise on 4173. It serves the game, the console, the claim page, the public postcard pages and the API from that one origin.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` once Postgres is connected, even while MinIO or Mailpit is unreachable.

### Configuration and secrets (DP-40)

The server reads these variables at start and never hard-codes their values:
- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`;
- `POSTBOX_KEY_TTL_SECONDS`, `RUSH_HOLD_SECONDS` and `POSTCARD_MAIL_WINDOW_SECONDS`, whose defaults and lowest values are in Business rules.

No credential, connection string or service URL ever reaches the browser, an email or a share page. That covers HTML, bundles, API bodies, headers and error messages. Any other environment variables are ignored.

### Server boundary (DP-24, DP-41, DP-58, DP-76)

- **Same origin only.** The server sends no cross-origin headers.
  - **The app's own origins** are exactly two: the scheme, host and port of `<base>`, and `http://` followed by the request's `Host` header value. Schemes and hosts compare without regard to letter case, and a port equal to the scheme's default may be left out. So `http://localhost:4173` and `http://127.0.0.1:4173` are different origins, and each is the app's own only when it matches `<base>` or the request's `Host`.
  - A state-changing request (any method other than GET, HEAD and OPTIONS, on any path) whose `Origin` header is anything other than one of the app's own origins gets 403 `{"error":{"code":"cross_origin","message":"<sentence>"}}`. The literal value `Origin: null` counts as foreign.
  - A request with no `Origin` header, or with one of the app's own origins, is allowed.
- **Body limits.** JSON bodies may be up to 16,384 bytes inclusive, and postcard uploads up to 2,000,000 bytes inclusive. Anything larger gets 413.
- **Request content types.**
  - A JSON endpoint accepts the media type `application/json` in any letter case, with or without parameters such as `charset`.
  - A zero-byte body on a JSON endpoint is judged as `{}`, whatever its `Content-Type` is and even if it has none. So an endpoint whose Request cell is `{}` accepts a POST with no body, and one with required keys answers it with 422 `required` for each missing key.
  - A non-empty body on a JSON endpoint gets 415 if its `Content-Type` is missing or is any other media type.
  - The postcard upload accepts only `image/png`, ignoring parameters. Any other type, or none, gets 415.
  - Endpoints whose Request cell is `—` ignore `Content-Type`.
  - Malformed JSON gets 422 with field `body`.
- **What is never served.** These are never served, and their paths answer 404: source files, server source maps, `run.json`, package manifests, lockfiles, `.env` files, the dependency folder and credentials. Unknown paths also answer 404, except the client routes `/`, `/claim`, `/console` and `/p/...`. The `/console` and `/claim` pages are served for any query string, so a reloaded or copied URL always loads them.
- **Nothing describes the machinery (DP-76).** Apart from the random ids and share links the app itself issues, no response body or header (503s, 404s, 500s and `GET /api/status` included), no HTML page (share pages, the returned-to-sender page and the claim page included) and no screen copy ever contains:
  - the store's address as the exact `host:port` string taken from `S3_ENDPOINT`, or the mail server's address as the exact `SMTP_HOST:SMTP_PORT` string. For example, when `S3_ENDPOINT` is `http://127.0.0.1:9`, the forbidden string is `127.0.0.1:9`;
  - the bare host name from `S3_ENDPOINT` or `SMTP_HOST`, but only when that host differs from the host of each of the app's own origins (see Same origin only). A bare port number is never forbidden on its own, because digits appear in times, ids and share links;
  - the value of `S3_BUCKET`;
  - an object key;
  - a driver, library or socket error name or text, or any of these words as a whole word in any letter case: `minio`, `s3`, `smtp`, `nodemailer`, `econnrefused`, `etimedout`, `ehostunreach`, `enotfound`, `getaddrinfo`;
  - a stack frame, a file path or a line of source.

  The darkroom and post-office 503 bodies are byte-exact as in Services. Any unexpected fault answers the fixed 500 from API, never an HTML error page. No response carries an `X-Powered-By` header or a `Server` header.
- **Share responses** carry the headers in their API rows, so a revoke or rename takes effect on the very next request and the image is never reinterpreted.
- **Dependencies at boot and recovery.**
  - If Postgres is unreachable at boot, the server keeps running, retries every 2 seconds, and answers health with the 503 from API until it connects.
  - If MinIO or Mailpit is unreachable, at boot or later, the server starts and runs normally. Only the affected actions answer their 503.
  - Every request that needs the store or the mail server tries it afresh. A cached failure is reused for at most 5 seconds.
  - After a service returns, `GET /api/status` and the affected actions work again within 10 seconds, without a restart.

### Browser support and performance (DP-02, DP-42, DP-51, DP-65)

- The game supports current Chromium, Firefox and WebKit at 375x812 (touch), 768x1024 (touch) and 1280x800 (mouse and keyboard).
- In headless Chromium with software WebGL at 1280x800:
  - the first frame of Bramble, which starts the intro dive, shows within five seconds of load, and `data-scene` reads `ready` from then on;
  - the Depot board is usable within three seconds;
  - the `data-*` attributes on the Bramble and Route regions update at least five times per second;
  - the route ribbon pixel rules in Visual design hold in screenshots.
- Without WebGL, the canvas area shows the paper message "Bramble needs WebGL to draw the planet." The cards still work, `data-scene` reads `no-webgl`, and `data-intro` and `data-ambient` read `off`.
- A hand-over result shows within one second of the response.

## Working rules

- IF-01: `/app/run.json` exists and contains exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, plus Fraunces, Atkinson Hyperlegible and Lucide. "Shipped packages" means the production dependency tree, as reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production dependency tree, as reported by `npm ls --omit=dev --all --json`) and every bundled font, icon or asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, CC0-1.0 or OFL-1.1.
- IF-04: The only datastores are the provided Postgres database, the MinIO bucket and Mailpit. There is no SQLite, Redis, embedded database or state file on disk.
- IF-05: The provided service configuration (compose fragments and service environment values) is left unchanged.
- IF-06: Server and browser application source is TypeScript. JavaScript appears only as build output or tool configuration.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript. Names match this brief's domain terms: courier, guest save, postbox key, return path, parcel, acceptance, hand-over ticket, purchase ticket, mail ticket, stamp ledger, movement, stamp history cursor, rush parcel, slot, hold, rush count, board day, studio wall time, revision, darkroom, post office, mail slot, presence stream, figure, moderation reference, audit entry, camera rig and thread phase.
- Each domain rule is decided in exactly one place in the source:
  - mission lifecycle moves and revision checks;
  - mission field validation and its reasons;
  - studio wall-time resolution, including skipped and repeated times;
  - the open-parcel check with its repeated accept and claim answers;
  - the rush claim winner, hold lapse, slot numbering and rush count;
  - acceptance ownership;
  - ticket storing, waiting and replay for hand-overs, purchases and postcard mail;
  - ledger pairing, balance and history paging;
  - the board date and the accepted time zone set;
  - display-name checking, folding, normalising, counting and live name lookup;
  - the accepted return paths;
  - arc and bearing maths;
  - the PNG chunk walk and the inflated-size check;
  - the postcard mail limit;
  - the published request fields;
  - heartbeat sequence handling, the emote window and the presence listing, including removal on sign-out and redeem;
  - mute with emote clearing, and audit snapshotting;
  - the Online now count;
  - session rotation;
  - the app's own origins;
  - the role checks;
  - the error shape, the error precedence and the fixed internal error;
  - each camera rig's pose and limits, and the reduced-motion mode that every animation reads live;
  - the thread phase timing that both the visible page and hidden-page resumption read, including when a pending accept or a lapsed hold is applied;
  - the matching of presence entries to drawn figures;
  - the mapping between the console URL and the editor.
- No abstraction has a single implementation, and no wrapper only passes calls through.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules above make impossible.
- Every API error is built in the one error shape and follows the one precedence order in API.
- Changes that must happen together happen in one transaction:
  - a delivery or purchase, its two ledger entries and its stored ticket;
  - a postcard mail's slot reservation, its count check and its stored ticket;
  - a merge;
  - a claim and its lapse;
  - a mute, its emote clearing and its audit entry;
  - a mission change and its revision bump;
  - a sign-out or redeem and its session's heartbeats.
- Nothing is built beyond this brief: no extra screens, endpoints, roles, analytics or third-party calls.
