# TRUTH — Interline Desk golden

Every value says where it came from: `brief: <section>` or `decided: <why>`.

## Journeys (ideal end-to-end)

1. **First run.** Fresh install → `/` → `Open the demo desk` → `/sign-in` → `robin@marlowquill.example` / `interline-demo-2026` (brief: Seed data) → `/desk`.
   Dashboard lists `Larkspur Rider`; analytics band reads 0 exact matches reused, 1 conflict open, 4 below MQM threshold, 0 publishes confirmed;
   the project's rail shows `main` and `feature/checkout-redesign` (brief: Journeys 1). Postgres holds the seed; MinIO and Svix hold nothing.
2. **Migrate a legacy TM.** TM screen → choose CSV → `Import`. Status `Imported <added> new entries, merged <duplicates> duplicates and reused <applied> exact matches.`
   (+ `<n> rows need attention.`); report lists each row by line; main untranslated segments fill from exact matches (origin `tm`, status `drafted`);
   the original is in MinIO at `projects/<id>/imports/<import id>` and downloads byte for byte. A second import adds nothing.
3. **Branch, edit, merge.** New branch → rename/edit keys through the API/editor → merge screen: `Request review`, `Resolve <key> <field>` (hold, then dialog), `Merge into main`.
   Main carries the key's id and full history (created, name, source, merged).
4. **Undo.** `Restore` on an import or merge restores main and the TM exactly from the snapshot stored in MinIO; refused with `restore_superseded` after any later change to main or the TM.
5. **Draft and review.** `Draft with AI` → TM first, then the engine routed per language; scores on arrival. `Assign review` → reviewer works `/review` by keyboard
   (J K A C) → on completion one `review.completed` Svix message `evt_rev_<assignment id>`.
6. **Publish.** `Publish` dialog → `Queued` → `Awaiting host confirmation` → `Published as pull request #42.` only after the host answers the pull request GET; one
   `locale.published` message `evt_pub_<publish id>`; CI pulls `/api/ci/projects/<slug>/locales/de.json` with its token.
7. **Erase.** Settings → `Erase project` → type slug → rows, MinIO objects, Svix application, tokens, scopes, audit entries removed; one anonymous `project.erased` entry; URL shows not found (404).

## Palette (brief: Colour roles; hex from DESIGN.md)
ground #FFFFFF, surface #F6F6F7, ink #131E29, muted #4B5563 (decided: AA on both grounds), primary #09090B, hairline #D6D6D6, outline #737373,
panel gradient #FBE3DC → #F3E1F0 → #E6E0FA, tile stroke #F19A8E → #B58AE6.

## Type, space, layout
Figtree (display/body), Inter (small UI) — brief: Typefaces. Body 18/16, h1 44/32, steps ×1.2 — brief: Scale. Column 1290px, 24px phone margins, 4px spacing.
Editor: 1 column <768 (editor, quality, segments), 2 columns 768–1023 (segments 2/5), 3 columns ≥1024 — brief: Segment editor.

Hero (decided: brief Landing asks for a bold one-line lead beside a ~600 px panel): from 1240 px the copy column takes the lead's one-line width
(Figtree 600 14/22, no wrap) and the panel the rest up to 600 px; below 1240 the lead is 20/30 and wraps.

## Motion
| Element | Trigger | Duration, easing | Reduced motion |
|---|---|---|---|
| rail underline | tab chosen | 200ms cubic-bezier(.4,0,.2,1), transform + width | instant |
| old / new panel | tab chosen | 150ms out; 200ms in after 50ms; opacity | instant swap |
| strip scroll | tab chosen (phone) | smooth (~300ms) | jump |
| buttons | hover | 200ms colour; arrow +4px | colour only, 0s |
| chevrons, hamburger | open | 200ms transform | instant |
| carousel | arrows, dots, swipe | smooth scroll (~300ms) | jump |
| wordmark strip | overflow only | 20s linear, 2 passes, paused on hover/focus | none |
| header border | scrolled >10px | 200ms | instant |

## States per async action
Pending, success and failure copy are the brief's Feedback states table verbatim (`status "Desk updates"`, `alert "Desk problems"`, field errors from the server `fields`).

## Decided (brief silent)
- Audit actions: `project.created`, `branch.created|review_requested|reopened|abandoned|merged|drafted`, `key.created|updated|deleted`, `segment.*`, `tm.imported`,
  `source.uploaded`, `conflict.held|resolved`, `operation.restored`, `reviewer.*`, `assignment.created|completed`, `publish.requested|published|failed`, `token.*`, `webhook.saved`, `workspace.seeded`, `project.erased`.
- Sessions, sign-in and sign-out are not audited (not domain state).
- Extra non-contract fields: `branches` on each item of `GET /api/projects`; `added`, `duplicates`, `applied`, `rows` on `GET .../tm/imports` items (the screens need them); history entries may carry `note`.
- Conflict values for presence conflicts are the words `present`, `deleted`, `changed`; a new key or a rename whose name main already uses needs a `custom` name.

## Media and licences
No raster media. Illustrations are inline SVG drawn for this app (SVG attributes in kebab case, which Preact sets verbatim); gradient icon tiles use a CSS gradient border and one shared `#tile-stroke` gradient for lucide glyphs; icons lucide-preact (ISC); fonts Figtree and Inter (OFL-1.1), see `THIRD_PARTY_NOTICES.md`.

## Disputes
- None open. The reference tests of this iteration match the app: `test_ai_draft_routing` checks the `ivt.a<tag>` key only for `de` (2 calls, `ivt.b`, `ivt.c`), and `test_audit_entries_and_csv` matches CSV rows by `(at, action, project)`. Both pass.
- Kit `golden-check` (seed originality) flagged standard CSS property names as Tailwind class prefixes; resolved on the kit side (`GENERIC_PREFIX`); the check prints `ok`. No app change was needed.
- `test_if_third_party_notices` and `test_if_licences_allowed` need `go` on the PATH of the test image; the local test image has none, so they were checked by hand with `go list -deps` against `THIRD_PARTY_NOTICES.md` (all seven modules listed).
