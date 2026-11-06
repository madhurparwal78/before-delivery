# TRUTH — Tidewrack Cairn golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Field capture and two-device sync** (brief: Journeys 1). Start: fresh browser, empty local
   notebook, status "Local only — not syncing". Load sample case → 14 notes, N0 open. Edit a note
   and add `[[...]]`; ~1 s after the last keystroke it is saved to IndexedDB; Backlinks lists the
   linking note. Account → Create account (browser's IANA zone sent) → "Account created — this
   browser is your first device." → Add Sync → "Sync active" → Enable sync for this notebook →
   Set vault passphrase (≥12 chars, decided: confirm field must match) → "Vault created — this
   notebook now syncs". Every note queues one encrypted revision (base null) and badges go
   pending → synced; status ends "All changes synced". Provider record: `vaults` row with the
   wrapped envelope only, one `revisions` row and one `vault-blobs/<vault>/<note>/<rev>.bin` per note.
   Reload offline: the service worker serves the shell, IndexedDB serves the notes.
2. **Approving a second device** (brief: Journeys 2). Sign in on a new browser → new unapproved
   device, one email "Approve a new Cairn device" (device name, sign-in time and expiry in the
   account zone, `<APP_PUBLIC_URL>/devices/approve/<token>`), status "Waiting for device approval —
   check your email". Approve → "Device approved. You can close this tab." The phone polls
   `/api/me` every 5 s; the first poll that sees approval opens Unlock vault; the right
   passphrase unwraps the key and the vault's notes appear (decided: the vault becomes its own
   notebook "<vault name> · synced" and is selected).
3. **Co-editing** (brief: Journeys 3). Owner → Invite partner → "Invite created — an email is on
   its way to <email>" (email has accept link, expiry, passphrase-separately line; no vault name).
   Partner signs in, `/invites/<token>` → Accept invite → "You've joined the vault. Enter the vault
   passphrase from <inviter> to unlock it." → `/` opens Unlock vault. Both edit from rev r; the
   later push gets `409 revision_conflict` with `head_revision`; that device pulls the head into the
   note, creates "<title> (conflict copy, <device name>)" with its own text (queued as a new note),
   shows the Conflict region and the "conflict" badge. Restore from History → new head revision
   whose blob is byte-identical and `restored_from` set.
4. **Boundary and publish** (brief: Journeys 4). Publish tab → Dossier address → Create dossier
   ("Draft"). Ring starts at hop 0 (decided: dossier.radius, else 0). Each hop crossing: fill
   (170 ms) → cut (280 ms) → count (440 ms) → preview re-render; counters equal the server's
   manifest preview (HOP table below). Pin a note private → boundary recomputed. "Server boundary
   matches: N public · M severed" enables Publish dossier → "Publish N notes and cut M links?" →
   "Published N notes · M links severed", state "Published", `/d/<slug>/` live.
5. **Editor review** (brief: Journeys 5). Create preview link → "Preview link ready — expires
   <when>", URL `/p/<token>/` in the read-only textbox; editor reads, follows links; Revoke (one
   confirmation dialog "Revoke preview link" → Revoke) → "Preview link revoked"; next request 410
   "This preview link has ended."; objects under `preview/<link_id>/` deleted.
6. **Reading on a phone, then takedown** (brief: Journeys 6). Nav, Linked from, search
   ("No published notes match <q>."), tooltips after 330 ms. Republish narrower → removed pages 404
   at once; Take down → "Dossier taken down", every address 404, `publish/<slug>/` empty.
7. **Subscription lapse** (brief: Journeys 7). Cancel → Kill Bill end-of-term; "Sync ends <when>".
   Sync: writable until period end + 7 calendar days (or `CAIRN_SYNC_GRACE_SECONDS`), then `403
   vault_read_only`. Publish: warning at takedown − 3 days, takedown at period end + 14 days; the
   sweep sends the warning once, takes down in a later sweep, state "lapsed".
8. **Storage outage** (brief: Journeys 8). Pushes 503 → status "sync paused: storage unavailable —
   <n> queued", badges "paused"; queue persists in IndexedDB; retry every 10 s pushes in order
   once MinIO answers.

### Boundary of the sample case (brief: Seed data)

| Hop | Notes public | Links severed |
|---|---|---|
| 0 | 1 | 4 |
| 1 | 4 | 6 |
| 2 | 7 | 4 |
| 3 | 9 | 4 |
| 4 | 10 | 3 |

## Palette (decided within brief: Visual design)

| Role | Hex |
|---|---|
| ground | `#0a0c10` |
| surface | `#13161b` |
| surface-2 | `#1a1e24` |
| line (decorative grid) | `#2c323b` |
| trace (outside nodes, neutral links, rings) | `#7b828d` |
| ink | `#ebe3d2` |
| muted | `color-mix(#ebe3d2 68%, #1a1e24)` ≈ `#a8a49a` |
| amber | `#f0a63a` (public nodes, joined links, Publish button, Published state, preview internal links, focus ring) |
| brick | `#d8644c` (cut links + scissor, conflicts, errors; always with an icon) |

## Type, space, layout

- Fraunces (headings, note titles), IBM Plex Sans (body, controls), IBM Plex Mono with
  `tabular-nums` (counts, revisions, hops, bytes, times) — brief: Type. Heading ratio 1.2 — brief.
- Spacing 4/8/12/16/24/32/48 px, radius 6/10 px, tap ≥ 44 px — decided / brief: Accessibility.
- ≥1024: rail 280 px · note column (68ch) · pane 320–400 px; Publish tab: pane 50vw, ring left,
  preview right — brief: Screens and layout.
- 760–1023: rail drawer (Files), note + pane; Publish tab: workbench full width, canvas over preview — brief.
- <760: note only; pane bottom sheet (Context, 78dvh; Publish 100dvh) — brief.
- Approval, invite, console: single centred column; console table scrolls vertically; <760 rows
  become labelled cards — brief.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| drawer / sheet in | open | 250 ms | cubic-bezier(.16,1,.3,1) | instant |
| drawer / sheet out | close | 170 ms | cubic-bezier(.4,0,1,1) | instant |
| dialog | open | 250 ms fade + 12 px rise | same | instant |
| badge | state change | 170 ms cross-fade | ease | instant |
| button hover / press | pointer | 100 ms | ease-out | instant |
| pending dot | request in flight | 1400 ms loop | ease-in-out | static |
| ring fill + check | crossing step 1 | 170 ms | ease-out | at once |
| cut halves + scissor | step 2 | 280 ms | cubic-bezier(.2,.8,.2,1) | dashed red at once |
| counters | step 3 | 440 ms (40 ms ticks) | ease-out | value set |
| preview | step 4 | at 930 ms | — | at once |
| boundary settle | release | 250 ms | cubic-bezier(.16,1,.3,1) | jump |

## States per async action (brief: Feedback states)

Global sync, per-note badge, account, device approval, plan, vault, restore, Exposure Ring,
publish, preview link, public pages and console copy are used verbatim from Feedback states.
Decided where silent: plan grace "Sync ended — writable until <when>", "Publish ended — dossiers go
offline <when>", lapsed "Sync has lapsed — vaults are read-only"; approval link unknown "This
approval link isn't valid…"; invite signed out "Sign in with the invited email address under
Account, then accept."; empty search "Type a word to search the published notes."

## Breakpoints

1024 px (rail drawer) and 760 px (context sheet) — brief: Screens and layout.

## Media and licences

Fonts: Fraunces (variable), IBM Plex Sans 400/500/600, IBM Plex Mono 400/500 — Fontsource 5.3.0,
SIL OFL 1.1, self-hosted (`app/public/fonts`, listed in `app/assets.json`). Icons: Lucide (ISC)
via lucide-react. Cairn mark: original inline SVG. No images.
