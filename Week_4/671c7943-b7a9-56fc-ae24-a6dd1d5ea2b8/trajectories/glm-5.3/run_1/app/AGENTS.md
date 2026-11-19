# Sollis Studio Folio — repository notes

Commissioning site for a fictional independent designer (brand identity, website design, digital product design). TypeScript on Node 22, served on 0.0.0.0:4173 (`APP_PUBLIC_PORT` overrides).

## Architecture

- `src/domain/` — shared model types (`model.ts`) and all published copy + seed content (`seed.ts`). Services, principles, process steps are fixed copy here, not in the DB; projects and statistics live in Postgres.
- `src/server/` — server-only code. `app.ts` holds the HTTP server and route dispatch; `database.ts` the Postgres layer (schema created idempotently at start, seed content stored when empty); `mail-service.ts` SMTP via nodemailer; `brief-service.ts` Gotenberg rendering; `content-shape.ts` the PUT /api/grading/content validation; `enquiry-checks.ts` the single source of the validation messages (shared with the client copy in `src/client/enquiry.ts`); `pages/` renders the HTML.
- `src/client/` — browser TypeScript compiled to `public/js` by `tsconfig.client.json` (module format esnext, no bundler). `site.ts` boots everything on `/`; `case-study.ts` handles the case study page; `enquiry.ts` the form; `spa.ts` the fetch-based main replacement used for cover carry and neighbour slides.
- `public/css/site.css` — the whole stylesheet; `fonts.css` declares the self-served @fontsource woff2 files.

## Gotchas learned

- Gotenberg 8.x moved the Chromium HTML conversion to `/forms/chromium/convert/html` (not `/forms/chromium/convert`) and requires the file part to be named `index.html`.
- `npm start` runs `dist/server/app.js`; static files are served from `public/` resolved relative to the compiled module, not `process.cwd()`.
- The client tab order on `/` is: skip link, home link, five nav links (1280+) / Menu (below), intro links, statistics tabs (one Tab stop), service buttons, filter radios (one Tab stop), then work links. Work links need `aria-label` with the project title (their visible text is the hidden caption).
- `hidden` attribute is defeated by any `display` rule on the same element; `.work-item[hidden] { display: none }` is required because the base rule uses `display: grid`.
- The `touch-action: pan-y` on `.showcase-track` is what allows pointer events to keep flowing for the swipe handler; without it Chromium cancels the pointer chain.
- Cover carry keeps the same document: work-link clicks, prev/next links and popstate all go through `replaceMainWith` (fetch + replace `<main>` + pushState), never a full navigation; the carry tile and hero fly use a module-level state in `spa.ts`.
- Reference numbering and the one-enquiry-per-submission rule live entirely in `App.storeEnquiry` (inside one transaction): concurrent same-submission requests answer 201 and 200 with the same body; duplicate reference races are retried via `storeEnquiryWithRetry`.

## Testing

Playwright (Chromium) smoke suites were used during development and live in /tmp (api-test.py, browser-test.py, interaction-test.py, journeys-test.py, a11y-test.py). The API suite covers the full error order, body limit boundaries (262144 allowed, 262145 → 413), replay, references, the brief PDF and the grading routes.
