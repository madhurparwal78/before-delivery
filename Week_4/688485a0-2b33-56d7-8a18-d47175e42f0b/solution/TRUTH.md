# TRUTH — Marrowpop Software Jarful (golden)

What the golden does, value by value. Each value says where it comes from: `brief: <section>` (copied from the brief) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (start state, actions, visible end state, provider-recorded end state)

1. **Fill a first jar.** Start: signed out, `/`. The hero card shows the sample Stage Sieve with bands 413, 620, 5, 5 over an
   input of 1240 (brief: Seed data). Choose *Start a project* (`/signup`), fill Name, Email, Password, *Create account*:
   Account status reads `Check <email> for your code` and the app moves to `/confirm`; Mailpit holds one message, subject
   `Your Jarful code`, body line `Your code is <six digits>` (brief: Services). Type the code, *Confirm*: the account is
   confirmed, an HTTP-only SameSite=Lax session cookie is set, the app lands on `/projects`. *Create project* with a project
   name and a first collection name lands on `/p/<pid>/c/<cid>`; the collection screen shows `NOTHING IN THIS JAR YET`.
   *Insert document* opens the editor with `{}`; typing a document and Ctrl+S saves (`Saved`), the address becomes
   `/p/<pid>/c/<cid>/d/<id>` and the list shows the document. PostgreSQL holds the user, project, member, collection, document
   (version 1) and a change row (sequence 1).
2. **Find the right documents.** With a seeded collection open, the empty query ran already (`4 documents matched, 4 shown`).
   Type `{"items.sku":"S1","items.qty":5}` in Filter, Ctrl+Enter: Query status announces `2 documents matched, 2 shown`,
   Query plan reads `Full scan` / `Examined 4 documents, returned 2`. The View radios switch List / Table / JSON using the
   loaded page; the Table is one grid with a single tab stop; arrow keys, Home, End move; Enter opens the document and the
   address becomes its document route.
3. **Shape a pipeline.** On Pipeline, *Add stage* appends `{"$match":{}}` and focuses its JSON textbox. Each stage card shows
   `Stage <n> of <total>: <count> documents out` (≤N when capped, `pass through` when disabled); the band's lime bar width is
   track × min(1, ln(1+out)/ln(1+input)). Editing a stage recomputes 300 ms after the text stops changing; moving, enabling,
   disabling and deleting recompute at once. Alt+Up/Down move the card; the Pipeline status announces
   `Stage moved to position <n> of <total>` / `Stage <n> deleted`. Delete opens `Delete stage <n> (<$stage>)?`. Pin takes an
   `_id` and slides a black marker to the stage that drops it. Every change is saved as the person's draft
   (`PUT .../pipeline`), restored on reload.
4. **Guard the data.** A full scan reads `Full scan`; creating a unique index from the Indexes form reads
   `Index <name> created`, then the same query reads `Used index <name>`. A collaborator saving a duplicate sees
   `Duplicate value <value> for unique index <name>` in the editor; a validator refuses with
   `Document failed validation at <path>: <rule text>` in a black chip with pink text. A run that would examine more than
   `JARFUL_SCAN_LIMIT` documents is refused with the guard message until an index narrows it.
5. **Invite a collaborator and a client.** Members screen: *Send invitation* creates a pending invitation
   (`Invitation created for <email>`), Mailpit receives subject `You're invited to <project> on Jarful` with
   `<inviter name> invited you to <project> as <role>.` and a link to `<APP_PUBLIC_URL>/invites`. The invitee signs up,
   accepts at `/invites` and lands on `/p/<pid>`. A reader sees `You have read access`. A role change applies to the very
   next request and, through the event stream's `role` event, to an open screen within 2 seconds.
6. **Edit together.** Documents carry a server version (1, then +1 per save). A stale save shows
   `This document was changed by someone else.` with *Reload* (server copy) and *Overwrite* (resend with the current
   version). A reader's filtered results gain, change and lose rows within 2 seconds without reload; focus and the editor
   draft are untouched.
7. **Load and hand over files.** *Load file* dialog: *Choose file*, Format radios, *Load*. The bytes are stored in MinIO at
   `imports/<id>` before any line is parsed. Bad lines produce `Import failed` and `Line <n>: <message>` items with nothing
   added; a clean file reports `Imported <n> documents`. *Download original file* returns the stored bytes. *Download* makes
   JSON lines or spreadsheet-safe CSV of the current filter and sort, stored at `exports/<id>.<ext>`. With storage down a
   banner reads `File storage is unavailable. Try again later.` and queries keep working.
8. **Work from a phone.** Below 768 px the Query, Results and Pipeline tabs hold the workspace; tapping a result opens the
   editor as a full-screen dialog with Save and Close; every control is at least 44 px.

## Palette (brief: Visual design Colour)

| Role | Hex | Source |
|---|---|---|
| ground (bubblegum pink, html, body, every screen) | #FF9ECE | brief: Colour; decided: hex (hue 330, lightness 81%) |
| panel (deeper, warmer pink) | #F78BBF | brief: Colour |
| ink | #1B0B14 | brief: near-black ink |
| deep plum (secondary text) | #4A1038 | brief: deep plum |
| acid lime (single primary action, current rail item, hero swipe, hero card edge and glow, Sieve bars and notches) | #D4FF3A | brief: Colour |
| code field (editor, JSON results, stage preview, Query plan, chips, banners) | #12060D | brief: near-black field |
| code text (pink monospace) | #FFB8DC | brief: pink monospace |
| code key (white) | #FFFFFF | brief: Syntax |
| schema plum segment | #5B1745 | brief: Schema rows |
| sieve track | #26101B | decided: near-black but distinct from the black card |
| form field | #FFD0E8 | decided: lighter pink so inputs read as inputs |

## Type, space, layout

- TikTok Sans (display and body), Martian Mono only in the black code and data panes, both bundled (`src/client/fonts`, SIL OFL
  1.1). Heading scale ×1.25 (16, 20, 25, 31, 39); project name in the rail weight 500; counts and stage numbers use tabular
  figures (brief: Type). Wordmark: weight 900, caps, `font-stretch: 150%`, 5vw tall (brief: Hero).
- Buttons, chips, tags and radios are full pills; panels, cards and code panes have square corners; rows are separated by
  spacing and the step between the two pinks (brief: Corners, Dividers). Controls are at least 44 × 44 px (brief: Controls).
- Focus: 3 px ink outline, 2 px offset, 2 px white halo (brief: Controls; decided: the halo keeps it visible on black).
- Layouts (brief: Workspace layouts): ≥1280 px rail 16vw, list and editor columns side by side, Pipeline stage list left of the
  preview; landing, account, project list, invitations and project home content starts at 30vw. 768–1279 px rail 25vw, panes
  stacked, preview under the stage list. Below 768 px rail is the *Collections* drawer, Documents/Pipeline use the
  Query/Results/Pipeline tabs, the editor is a full-screen dialog, Indexes, Schema, Rules, Members and Saved queries stack.
- Separators: values 20–80, start 30 (query pane) and 50 (pipeline pane), arrows ±5, Home 20, End 80, pointer drag
  (brief: Interactions).

## Motion table

| Element | Trigger | Duration, easing | Reduced-motion substitute |
|---|---|---|---|
| Stage Sieve bar and numeral, bands k..n | stage k changes | 320 ms, ease-out quart, band j starts 40 ms × (j − k) later; numeral counts in whole numbers (brief: Stage Sieve) | final state in the first frame |
| Pin marker | pin result | same timing, slides down the bands | final position at once |
| Hero card bars | first load of `/` | same, once, from zero (brief: Hero card) | final state at once |
| Dialogs, drawer, menu, editor column | open | 250 ms fade-slide (brief: Interface transitions) | none |
| Same | close | 160 ms, `inert` and `aria-hidden` apply at the start | none |
| Buttons | hover, press | 100 ms background darken | none |
| Toast | after Save query, Delete, Drop, Remove, Revoke | 250 ms in, auto-dismiss after 4 s (decided: those actions have no copy in the brief) | none |

Nothing loops (brief: No loops).

## States per async action

Query: `Running query` → result text / `Query not run` + `Query error` copy. Save: `Saving` → `Saved` / document message chip /
clash alert / `This document no longer exists` / `You have read access`. Import: `Loading file` → `Imported <n> documents` /
`Import failed` + `Line <n>: <message>` list / `File has more than <N> lines`. Index: `Creating index` → `Index <name> created`
/ `Index keys are not valid` / duplicate text. Rules: `Rules saved` / `Rules are not valid`. Members: `Invitation created for
<email>` / `Already a member` / `Already invited`. Account: sign-up, code and credential messages exactly as in the brief.
Data panes carry `aria-busy="true"` and a skeleton while loading (brief: Loading).

## Media and licences

No photographs. The empty-state jar and the Lucide icons are drawn inline as SVG. Fonts: TikTok Sans (Copyright 2024 TikTok Inc.)
and Martian Mono (Copyright 2020 The Martian Mono Project Authors), SIL OFL 1.1, listed in `app/assets.json`. Packages and
licences are listed in `app/THIRD_PARTY_NOTICES.md`.
