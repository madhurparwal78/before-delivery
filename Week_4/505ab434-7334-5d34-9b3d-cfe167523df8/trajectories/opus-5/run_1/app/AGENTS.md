# Rulehouse — repository notes

Rulehouse is a brand rulebook and logo-usage grant desk for the invented brand Quenby & Co.
One TypeScript server on Node 22 serves the API, the signed download links and the single-page client.

## Layout

- `src/server` — HTTP server, routes, domain rules, seed and services
  - `domain/` holds the single decision points: `availability.ts`, `grantWindow.ts`, `routing.ts`,
    `transitions.ts`, `conditions.ts`, `cards.ts`
  - `services/` composes database writes, audit records, outbox mail and live events
  - `routes/` maps HTTP to services and owns the published error order
  - `http/` holds the request context, response helpers and the standalone HTML error page
- `src/client` — the browser app (no framework): `main.ts` routes, `pages/` render screens,
  `figures/` holds the four interactive figures, `marks.ts` holds every inline glyph
- `src/shared` — types and label vocabulary used by both sides

## Rules that are easy to break

- Time comes from the app clock in `app_clock` (see `clock.ts`), never from the system clock.
  `POST /api/grading/clock` advances it and fires due timers in due order.
- The availability decision, the grant window, stage routing and each state machine live in exactly
  one module each. Every caller goes through them.
- Audit records are appended inside the same transaction as their change. The canonical form and the
  hash chain are in `audit.ts`; the worked example in the brief is covered by the seeded chain.
- Library, request, grant and queue responses carry only the published keys.

## Working locally

- `npm run build` compiles the server with `tsc` and bundles the client with esbuild into `dist/`.
- `node dist/server/index.js` serves on `APP_PUBLIC_PORT` (4173).
- The database seeds itself with the demo dataset when it is empty.
- `npm run notices` regenerates `THIRD_PARTY_NOTICES.md` from the production dependency tree.
