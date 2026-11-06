# TRUTH — Oddment Workspace

Every value says where it came from: `brief: <section>` or `decided: <why>`.

## Journeys

1. **First open, no account** (brief: Journeys 1). Start: new browser. `/` shows `12 of 12 documents` from device storage; no dialog, no spinner; Sync status `This workspace is only on this device.`; root gains `data-offline-ready="true"` once the service worker holds the shell. Offline reload shows the same list and every route. Provider: nothing sent.
2. **Writing and laying out** (brief: Journeys 2). `New document` puts it first and focuses the title; Enter moves to an empty paragraph; slash menu changes types; `Switch view` deals cards, connectors after the last lands, state `canvas`; moving and connecting persist; `Switch view` gathers back with focus on the same block and page order unchanged. Provider: on a syncing device each record reaches `change_log`.
3. **Keeping records** (brief: Journeys 3). `/records/seed-bills` shows 8 rows, total `393.95`; filter updates count and total in place; board moves set the select value; CSV round trip reports bad rows by number.
4. **The daily note** (brief: Journeys 4). `/journal` shows today at `/journal/<date>` from `Daily note`; other days keep their own note; ids derive from the date so two devices end with one note and one template body.
5. **Second device** (brief: Journeys 5). Create account, choose upload, `All changes are synced.`; second device signs in, chooses upload, sees the merge; edits arrive within 10 seconds.
6. **Two edits, both kept** (brief: Journeys 6). The second device's stale base makes `change_log` hold `bothKept` values; both devices show them in Keep order; the first pick to reach the account stands.
7. **Sharing and retiring** (brief: Journeys 7). `Create link` writes `share_links`; `/s/<token>` reads latest synced content; revoke kills it; Delete forever removes `change_log` rows, share links and objects and leaves only the id in `deleted_documents`.
8. **Losing a phone** (brief: Journeys 8). `Remove <device>` deletes the device row and session; the phone's next check gets `{}` and shows the published notice, keeping its work.

## Palette (decided: hex for the brief's colour roles; roles from brief: Visual design)

Light: table #123B2E, table-edge #0D2C22, on-table #F6F0E1, paper #F6F0E1, paper-deep #ECE3CF, ink #16231D, ink-soft #46544B, rule #B9AC93, rule-strong #6F6552, accent #C4500F, focus-edge #FBF7EC.
Dark: table #07130F, table-edge #030A08, on-table #EFE7D6, paper #1F2A25, paper-deep #27332D, ink #EFE7D6, ink-soft #BDBBA9, rule #4A584F, rule-strong #8A9A8F, accent #C4500F, focus-edge #FBF7EC.

## Type (brief: Type; sizes decided: body 17px at a 1.25 ratio)

Newsreader 500: h1 33.2px, h2 26.6px, h3 21.25px. Newsreader italic 400 for quotes, 20px. Atkinson Hyperlegible 400 body 17px, small 14px, 700 for emphasis.

## Space and layout (brief: Screens and layout)

Unit 4px; targets 44px; radius 2px; edges 1px; hard shadow `2px 2px 0`. 1280: 200px rail, main, 280px inspector. 768: drawer, main, 240px inspector. 375: one column, drawer, full-screen inspector sheet. Canvas view closes the inspector at 1280 and 768.

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| card travel | Switch view (brief: The Deal) | 320ms, 30ms stagger capped so the last starts by 600ms | decided: quartic ease-out, no overshoot | none; 120ms crossfade |
| sheet fade | same | 180ms (brief) | linear | crossfade |
| connectors | after last card lands | 180ms (brief) | ease-out | appear at once |
| reversal | press during motion | at most 320ms (brief) | quartic ease-out | crossfade |
| dialogs, drawer, sheet in | open | 200ms (decided: within a quarter second) | cubic-bezier(0.16, 1, 0.3, 1) | instant |
| panels out | close | 120ms (decided: faster than in) | ease-in | instant |
| press, hover | pointer | 80ms (decided) | linear | instant |

## States per async action

Sign in, create account, create link, remove device: pressed control disabled with the published pending word; failure shows the published copy in the dialog and announces it. Attachment: `waiting` > `stored` or `refused`, retried every 5 seconds. Sync: first matching row of the Sync status table, `syncing` held at least 500ms (brief: Feedback states).

## Breakpoints (decided: boundaries around the three published viewports)

Below 640px phone; 640 to 1023px tablet; 1024px and up desktop.

## Media and licences

Newsreader and Atkinson Hyperlegible woff2, OFL-1.1, from Fontsource 5.2.6. Lucide icons, ISC. `public/icon.svg`, brand mark and paper stack drawn for this app.
