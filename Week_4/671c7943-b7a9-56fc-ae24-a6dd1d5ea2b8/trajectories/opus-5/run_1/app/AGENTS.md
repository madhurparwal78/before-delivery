# Sollis Studio Folio — working notes

The commissioning site of Maren Sollis: one home page with six sections, a case study
per project, a privacy page and a brief PDF per enquiry. TypeScript on Node 22, no
framework.

## Shape of the code

```
src/shared/     types, published copy and the enquiry checks used by server and browser
src/content/    the published page copy, the starting content and the selection helpers
src/render/     server-rendered HTML: layout, home, case study, small pages, plates, brief
src/server/     http server and routes, Postgres, SMTP client, Gotenberg client, business rules
src/client/     the browser bundle (esbuild), one module per behaviour
public/app.css  the single stylesheet
```

* `build.mjs` runs `tsc` for the server, type-checks the client, bundles
  `src/client/main.ts` with esbuild and copies the stylesheet and the woff2 files into
  `dist/public/assets`.
* The server serves `dist/public/assets/**` only; everything else answers the
  not-found page.

## Decisions worth remembering

* **One place per rule.** Enquiry checks live in `src/shared/validation.ts` (browser and
  API), references come from the Postgres sequence `enquiry_reference_seq`, the
  one-enquiry-per-submission rule lives in `src/server/enquiries.ts`, counts and
  sequences in `src/content/selection.ts`.
* **Dedupe.** `submitEnquiry` keeps an in-flight promise per submission id, so two
  requests that arrive together share one answer; a later request finds the stored
  enquiry and answers 200.
* **Mail.** A small SMTP client in `src/server/mail.ts` (no library: nodemailer is
  MIT-0, which the licence rule does not allow). Line breaks travel as the
  quoted-printable escape `=0A`, so the decoded message holds the stored text
  character for character.
* **Brief PDF.** `src/render/brief.ts` works out the largest text size at which the
  whole description fits one A4 page; the measure is set in `ch` so the characters per
  line do not depend on the font Chromium picks. Chromium clips transformed content per
  printed page, so scaling with `transform` is not an option.
* **Cover Carry.** `src/client/router.ts` fetches the case study, swaps `[data-view]`,
  keeps the home `main` node in memory and plays the FLIP move. `history.scrollRestoration`
  is `manual`; the browser would otherwise fight the scroll back to the tile.
* **Focus.** `src/client/focus.ts` keeps every focused element at least 72 px from the
  top. Section jumps aim for 88 px and mark the target exempt so the guard does not
  cancel the smooth scroll. On a first load with a hash the jump waits for `load`,
  because the browser's own fragment scroll resets focus to the body.
* **Menu.** Focus cannot leave an open modal `<dialog>`, so a menu link closes the menu
  first and jumps once the panel has slid away.
* **View listeners.** Everything view-scoped is registered through `listen()` in
  `src/client/dom.ts` and removed by `disposeView()`; the home DOM survives navigation,
  so plain `addEventListener` would bind twice.
* **Statistics tabs.** The accessible name comes from a visually hidden copy of the
  final value, not from `aria-label`: the visible number counts up and axe's
  label-content-name-mismatch rule would fail.

## Checking the work

`GRADING_KEY`, `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `STUDIO_EMAIL`
and `GOTENBERG_URL` come from the environment. Useful probes during development:

```sh
curl -s localhost:4173/api/health
curl -s -X DELETE -H "X-Grading-Key: $GRADING_KEY" localhost:4173/api/grading/content
curl -s -H "X-Grading-Key: $GRADING_KEY" localhost:4173/api/grading/enquiries
curl -s "$MAILPIT_URL/api/v1/messages?limit=5"
```

Outage copies run with `SMTP_HOST` or `GOTENBERG_URL` pointed at an unreachable
address; both must still serve every page and store enquiries.
