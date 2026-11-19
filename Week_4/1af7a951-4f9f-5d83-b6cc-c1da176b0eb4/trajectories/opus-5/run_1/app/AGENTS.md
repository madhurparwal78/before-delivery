# Lanternfish — repository notes

Lucid-dreaming cohort app: applicants enrol and pay for a seat, dreamers keep an
offline-capable dream logbook with dream-sign tagging, coaches run cohorts and
read aggregates only.

## Layout

- `src/` — Node 22 server (TypeScript, `strict`), compiled by `tsc` to `dist/`.
  - `config.ts` reads every service URL and credential from the environment.
  - `domain/` holds each rule in exactly one place: `cohort.ts` (phase,
    transitions, seats left), `night.ts` (night key, held night, capture window,
    wake alarm), `signs.ts` (halo radius, target category), `landing.ts`
    (sign-in landing), `fields.ts` (field messages and the `Validated` result),
    `time.ts` (accepted time zones, local moments), `memoSignature.ts`.
  - `http/` holds the one error shape (`errors.ts`), the precedence ladder and
    same-origin rule (`router.ts`) and byte-range parsing (`ranges.ts`).
  - `store/` holds SQL projections (cohort view, enrolment view, entry view,
    roster aggregates). `api/` holds endpoint handlers, `services/` holds the
    Kill Bill, MinIO and SMTP clients.
- `client/` — browser app (TypeScript, bundled by esbuild to `dist/public`).
  - `logbook/` holds the workspace: `journal.ts` reconciles night sections and
    entry articles in place (never rebuilt during refreshes), `keep.ts` stores
    device-kept entries in `localStorage` and memos in IndexedDB stamped with
    the enrolment id, `sync.ts` sends kept work, `dreamscape.ts` owns the
    condensation phases, `sky.ts` draws the WebGL sky with a 2D fallback.
  - `sw.ts` is the service worker that serves the shell offline (needed so a
    reload at 4 a.m. in airplane mode still shows kept entries).
- `build.mjs` type-checks `tsconfig.json`, `tsconfig.client.json` and
  `tsconfig.sw.json`, bundles the client, and copies the two bundled fonts.

## Working habits

- `npm run build` then `node dist/server.js` (port 4173, or `APP_PUBLIC_PORT`).
- The schema is applied on every boot; the seed runs only into an empty
  database. To get back to the published seed, drop the tables and restart.
- Kill Bill external keys: account and payment use the enrolment id, purchase
  transaction `<id>-purchase`, refund transaction `<id>-refund`.
- Mail goes out through `src/services/smtp.ts` (plain SMTP, base64 body,
  RFC 2047 subject) because every nodemailer release is MIT-0, which the
  allowed-licence list excludes.
- Licence list in `THIRD_PARTY_NOTICES.md` comes from
  `npm ls --omit=dev --all --json` plus the two OFL fonts.

## Gotchas learnt here

- Live regions must stay in the accessibility tree while empty, so they use
  `margin: 0` instead of `display: none` when empty.
- Native `<dialog>` gives the focus trap and inertness the brief asks for, but
  the element must be in the document before `showModal()`.
- The roster view sets an explicit height (never below 320 px) so its sticky
  header row and `Dreamer` column pin while the page never scrolls sideways.
- Oversized bodies are drained before answering 413, otherwise the client sees
  a connection reset instead of the response.
