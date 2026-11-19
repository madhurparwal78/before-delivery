# Mullion

Mullion is a hosted visual editor for CSS grid layouts. A designer shapes column and row tracks, gaps and
named areas by mouse, touch or keyboard, sets separate overrides for wider screens, steps a live preview
across widths and copies exact HTML and CSS. CSS can be pasted back and applied to the visual grid. Two
designers can edit one layout at the same time and see each other's presence and changes live. The server
keeps every layout, its ordered change history and its saved versions, and a developer reads a layout
through a read-only view link.

Pages: `/signup`, `/signin`, `/` (your layouts), `/layouts/<id>` (the editor), `/view/<token>` (read-only
view) and `/join/<token>` (co-edit link).

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server with `tsc`, bundles the client with Vite) |
| serve | `npm run start` (a foreground Node 22 process on `0.0.0.0`) |

The server serves the pages, the API and the live WebSockets on one port. If Postgres is not reachable it
still listens, answers `GET /api/health` with `503 {"status":"starting"}` and retries every second. If
Valkey is not reachable it starts in the paused state: everything saves through Postgres, nothing is pushed
live, and the pages show "Live updates are paused. Your changes are still saved."

## Environment

Read once at start, in `src/server/config.ts`. None of them is sent to the browser.

| Variable | Meaning | Service |
|---|---|---|
| `DATABASE_URL` | Postgres connection URL; designers, sessions, layouts, change log, versions and links live here | Postgres |
| `VALKEY_URL` | Valkey connection URL; presence keys `presence:<layout id>:<username>` and the channel `layout:<layout id>` | Valkey |
| `GRADING_KEY` | Key for `POST /api/grading/setup` (header `X-Grading-Key`); without it the route looks absent | |
| `PRESENCE_SECONDS` | Presence key expiry, renewed every quarter of it (default 30) | Valkey |
| `MAX_TRACKS` | Most columns and most rows in one scope (default 12) | |
| `MAX_BREAKPOINTS` | Most breakpoints in one layout (default 3) | |
| `APP_PUBLIC_PORT` | Listening port (default 4173) | |

## Notes

- The schema is applied idempotently at every start.
- Changes to one layout are applied under a row lock, so revisions count up by one in arrival order.
- No data is seeded: the app starts with no designers and no layouts.
