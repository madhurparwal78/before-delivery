# Scopewright — repository notes

Scopewright is a PCI DSS scoping diagram workspace: network and account-data-flow
diagrams with scope zones, derived zone membership and boundary crossings,
one-person sharing, exports, imports and an audit trail.

## Running it

- `/app/run.json` is the only entry point: `npm ci`, `npm run build`, `node dist/server/index.js`.
- Everything is configured through the environment (`DATABASE_URL`, `S3_*`, `SMTP_*`,
  `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` and the timer variables). Nothing is hard-coded.
- `npm run build` compiles the server with `tsc`, bundles the browser app with esbuild,
  copies the self-hosted IBM Plex woff2 subsets and regenerates `THIRD_PARTY_NOTICES.md`.
- Several instances may share one database and bucket. Schema and seed data are applied
  idempotently at every start; sessions, the mail queue and idempotency keys live in
  PostgreSQL so instances agree.

## Layout

```
src/shared/   rules both the browser and the server use
src/server/   http layer, routes, domain services, storage and mail clients
src/client/   browser app (vanilla TypeScript, no framework)
```

### One place per rule

| Rule | File |
| --- | --- |
| Zone membership, crossing points and direction | `src/shared/derive.ts` |
| Ports, elbow path, routing, zone overlap | `src/shared/geometry.ts` |
| Zone carry, align, duplicate, layer order, delete | `src/shared/editing.ts` |
| Label stack rule and plain labels | `src/shared/labels.ts` |
| Page validation and dangling connectors | `src/shared/validate.ts` |
| Published copy | `src/shared/copy.ts` |
| Boundary announcement order | `src/shared/boundary.ts` |
| `next` check and landing paths | `src/shared/routes.ts` |
| Origin rule, body limits | `src/server/http/request.ts` |
| Security headers, Content-Disposition | `src/server/http/headers.ts` |
| Error precedence | `src/server/http/router.ts` |
| Sessions and cookies | `src/server/domain/sessions.ts` |
| Sign-in lockout | `src/server/domain/lockout.ts` |
| Share state machine, invitation limits | `src/server/domain/shares.ts` |
| Download link checks | `src/server/domain/downloads.ts` |
| Export readiness and idempotency | `src/server/domain/exports.ts` |
| Import parse limits and safety | `src/server/domain/xml.ts`, `importer.ts` |
| Save queue and save state | `src/client/editor/state.ts` |

## Things worth knowing

- Derived values are computed by `deriveFromPage` inside the same transaction as a page
  save and stored next to the document; the editor runs the same function to show the
  result before the save answers.
- The browser never receives a storage URL: every export file and imported original is
  fetched through a short-lived, person-bound download link.
- The canvas is inline SVG. Items are `tabindex="-1"` and Tab order inside the canvas is
  handled in `handleTab`, so paint order and reading order stay independent. Canvas
  pointerdown calls `preventDefault` so the browser does not move focus off an SVG item.
- Dialogs, sheets and drawers go through `openPanel` in `src/client/dom.ts`: it makes the
  rest of the page inert, wraps Tab, handles Escape and returns focus to the opener.
- The boundary tally animation lives in `src/client/editor/motion.ts` (morph 200 ms,
  staggered markers 40 ms apart capped at twelve, tallies roll 300 ms, announcement last).
- Passwords use scrypt; session ids, invitation tokens and download tokens are stored only
  as SHA-256.
