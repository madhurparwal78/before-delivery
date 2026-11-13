# Twinrow

A shared web workspace for knitting and crochet chart design. One chart is the single source
of truth: the server checks each row's stitch arithmetic, writes the instructions from the
chart, reads typed instructions back into the chart, and lets designers edit together while
testers work a saved version row by row.

## Running it

- `npm ci`, `npm run build`, `npm start` (see `/app/run.json`). The server binds `0.0.0.0:4173`,
  honouring `APP_PUBLIC_PORT`, applies the database schema on start and serves the built client
  from `dist/client`.
- Services: Postgres (`DATABASE_URL`), Valkey (`VALKEY_URL`), Mailpit over SMTP (`SMTP_HOST`,
  `SMTP_PORT`, `MAIL_FROM`). Every credential and limit is read from the environment in
  `server/config.ts`.
- `npm run typecheck` runs both TypeScript projects.

## Layout

- `src/domain/` is the one place every chart rule lives, shared by server and browser:
  - `symbols.ts` symbol tables, `chart.ts` reading order and row items, `rows.ts` the row rule
    and colour warnings, `instructions.ts` runs, repeat detection and written lines with their
    twin tokens, `grammar.ts` the text grammar and how text lays into cells, `mirror.ts`,
    `repeats.ts` repeat box expansion, `compare.ts` version comparison.
  - The browser uses these only to derive twin token mapping from the server's cells; counts,
    text and errors shown come from the server's answers.
- `server/` the HTTP server (`index.ts`, `http.ts`), Postgres (`db.ts`, `patterns.ts`), Valkey
  presence, pub/sub and the row counter (`valkey.ts`), the websocket fan-out (`live.ts`), the
  hand-built PDF sheet (`pdf.ts`), mail over a small SMTP client (`mail.ts`), copy strings
  (`copy.ts`) and the routes in `server/routes/`.
- `client/` the React app: `app.tsx` routing and the live socket, `shell.tsx` the top bar, rail
  and panel, `designerstate.ts` the designer's data and edit plumbing, `pages/` one file per
  screen, `components/` the grid, written instructions, panels and dialogs.

## Things worth knowing

- Cell edits are never applied optimistically: the browser sends the edit and renders the
  server's answer, so cells, counts and lines always change in one render. Each cell carries
  the revision this person's earlier edits left (`pendingRevs`), so quick keystrokes do not
  conflict with themselves.
- Live updates go out over Valkey pub/sub and come back through the app's own websocket, even
  with one process. With Valkey unreachable everything still saves to Postgres; the pages show
  the live-updates notice and catch up on reload.
- Undo is per person: each step keeps the revisions its own edit left, so a cell another
  designer changed later is refused by the server and reported in `status "Chart sync"`.
- Keyboard handling for the chart sits on `region "Chart"`; the follow page listens on the
  window so `n`, `p` and Space work wherever focus is.
