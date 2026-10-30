# Plumbline — repository notes

Plumbline is the Marrow Hall Interiors delivery workspace. Read `USER_README.md`
first for how to run it and which environment variables it reads.

## Shape of the code

- `src/shared` — vocabulary (`domain.ts`), instant and amount rendering
  (`format.ts`), zoned wall-clock arithmetic (`zoned.ts`), grapheme counting
  (`chars.ts`) and the one copy of every field error (`fieldErrors.ts`). Both the
  server and the browser import these, so a rule's wording exists once.
- `src/server/domain` — one module per domain rule. Each of these is the only
  place that rule is decided: `money.ts` (whole cents, one half-up rounding
  helper), `revisions.ts` (A, B, C on, skipping I and O), `levelling.ts`,
  `retention.ts`, `storeSplit.ts` (largest remainder, store-code tie-break),
  `reviewClock.ts` (Hong Kong working days, 17:00 cut-off), `defects.ts`,
  `transitions.ts` (every state machine), `finishesImport.ts`, `csv.ts`,
  `access.ts` (brand and company scoping) and `validate.ts`.
- `src/server/http` — `errors.ts` holds the one error shape, `router.ts` writes it
  to the wire, `context.ts` reads bodies under the published limits, `pages.ts`
  decides the status of each page address.
- `src/server/routes` — the published API routes only.
- `src/client` — `lib/` holds the router, the API client, the live regions, draft
  keeping and the focus helper; `components/` holds the design system, the
  dialog, the Intent seam and the featured rail; `screens/` holds the screens and
  `screens/panels/` the eight project panels.

## Things worth remembering

- **Error precedence is positional.** Each route handler performs its checks in the
  published order: body limit, session, removed access, idempotent replay, not
  found, role, state conflict, validation, rate limit, provider outage. Keep new
  checks in that order rather than adding a guard at the top.
- **The sign-off unit holds a row lock across the Kill Bill call.** That is what
  makes "exactly one invoice" true under a race. Lock the `stages` row on its own,
  never through a join: Postgres re-reads the locked row after the wait but not
  the joined tables, so a joined signer name comes back stale or null.
- **`startPending` versus `say`.** `startPending` clears the alert region; `say`
  leaves it alone. A multi-file upload must be able to report a refusal and a
  batch summary at the same time.
- **Focus targets go through `focusWhenReady`.** The published target is often
  created or enabled by the action itself, so a plain `setTimeout(…, 0)` races
  React's commit.
- **Pointer capture retargets clicks.** The seam's snag markers deliberately do not
  call `setPointerCapture`: capturing on the frame sent the click to the frame and
  the marker's own handler never ran.
- **The rail's card offsets cancel the track translation.** Measure each card
  against the track's own rect, not against a rect adjusted by the offset.
- **`useResource` forwards ended sessions and removed access** to the workspace, so
  a background load, not just a form submit, replaces the screen.
- **Licences are checked.** `npm run notices` rewrites `THIRD_PARTY_NOTICES.md`
  from the lockfile. Only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD,
  BlueOak-1.0.0, CC0-1.0 and OFL-1.1 may ship. nodemailer is MIT-0, which is not
  on that list, so mail goes out through `src/server/services/smtp.ts` instead.
- **Images are drawn, never bundled.** Renders, site photos, drawing sheets and
  case-study covers come from `src/server/services/procedural.ts`.
- **The tender sign-in page must show the tender's name without using the link.**
  The name is injected into the HTML shell by `shellFor` in `src/server/index.ts`,
  because reading it through an API call would consume the single-use link.

## Checking a change

There is no test runner in the repository. The quickest full check is:

1. `npm run build`
2. `node dist/server/index.js`
3. Sign in as `avery.tsang@marrowhall.example` with `Marrow-Hall-2026` and walk
   the journey you touched.

When verifying with a browser, remember that the office screens fetch after mount,
so `networkidle` alone is not enough; wait for the control you are about to use.
