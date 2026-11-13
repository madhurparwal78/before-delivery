# Kerfwell Rack

A web app for small reclaimed-timber yards. Every salvaged board is listed as its own item, drawn to
scale with its defect zones. Yard hands tag boards on a phone; the owner grades, prices by the board
foot (with dated rate versions), lists boards on the rack, corrects lineages and watches stock on
hand. Makers filter the rack, lay their cut list on one board, check it clears every defect, keep the
layout as a `.kerf` file, hold the board with a deposit and pay only for the length they take.

## Run it

`run.json` holds the three commands the deployment uses:

| Step | Command |
|---|---|
| install | `npm ci --include=dev` (uses `package-lock.json`) |
| build | `npm run build` (type-checks, bundles the server to `dist/server.js` and the browser app to `dist/public/`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0`) |

On every start the server waits for PostgreSQL, applies the schema and writes any missing seed rows
(people, lots, rates and the ten seed boards), so an empty database works with no separate step and
a restart changes nothing. `GET /api/health` answers `{"status":"ok"}` once it serves, whether or
not Kill Bill and MinIO are reachable.

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `DATABASE_URL` | PostgreSQL, the only system of record (boards, lineage, rates, layouts, holds, tickets, ledger, sessions) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: board photos (original, display, thumbnail) and cut ticket PDFs; the bucket is created if missing |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per maker, deposits and sales as PURCHASE payments, cancels as REFUND |
| `HOLD_SECONDS` | how long a confirmed hold lasts (default 172800, 48 hours) |

None of these reach the browser. When Kill Bill or MinIO is unreachable the app keeps serving,
reports it at `GET /api/services`, shows a banner, and recovers on its own when the service returns.

## Seeded sign-ins

| Person | Email | Password | Role |
|---|---|---|---|
| Dana Whitlock | owner@kerfwell.test | rack-owner-2026 | owner |
| Teo Varga | hand@kerfwell.test | rack-hand-2026 | yard hand |
| Ines Albrecht | ines@makers.test | rack-maker-2026 | maker |
| Joel Mbeki | joel@makers.test | rack-maker-2026 | maker |
| Ruth Calloway | ruth@makers.test | rack-maker-2026 | maker |

## Layout

- `src/shared/` — the domain rules used by both sides (piece status, cuts and take, price, invoice lines, units, formats).
- `src/server/` — HTTP boundary, PostgreSQL schema and seed, MinIO and Kill Bill clients, photo copies, ticket PDFs, routes.
- `src/client/` — the React screens: rack, board detail, sign in, account, yard, owner, cut ticket.
- `public/` — the page shell, styles and self-hosted fonts.
