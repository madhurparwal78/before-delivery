# Twigline — repository notes

Twigline is a one-outline-per-person web outliner by Pellwick & Ash: nested bullets, branch
zoom, live copies (mirrors), single-branch sharing and plain-text/Markdown/OPML downloads.
One TypeScript app server serves the TypeScript frontend and the API. Three backend
services and no others: Postgres (durable store), Mailpit (sign-up codes and invitations),
Valkey (live fan-out between server connections).

## Running it

```
npm ci          # install
npm run build   # type-check, then bundle the server and the client into build/
node build/server.js
```

`/app/run.json` holds the same three commands. The server binds `0.0.0.0:4173` or
`APP_PUBLIC_PORT`. `GET /api/health` answers `{"status":"ok"}` once Postgres is reachable and
`{"status":"starting"}` (503) before that. Everything else — service URLs, timers, limits and
`GRADING_KEY` — is read from the environment at start and never reaches the browser, except
the pause and heartbeat values, which travel in the live socket's first heartbeat.

## Layout

```
src/shared/    copy.ts (every published string), types.ts, moves.ts (the one move check),
               search.ts, dates.ts, tags.ts
src/server/    index.ts (http, static, websocket upgrade), routes.ts (route table),
               http.ts (body limits, cookies, error shape), errors.ts (the one error order),
               db.ts, tree.ts (display tree with copies), scope.ts (collaborator bounds),
               mutations.ts, changes.ts (sequence numbers), history.ts (undo/redo),
               outline.ts (reads, search, suggestions), export.ts, shares.ts, accounts.ts,
               mail.ts + smtp.ts, live.ts (Valkey streams and sockets), purge.ts, seed.ts,
               setup.ts (grading setup and the outline builder)
src/client/    main.ts (router), marketing.ts, auth.ts, styles.css,
               outline/ screen.ts (the outline screen), model.ts, rows.ts, board.ts,
               share.ts, dialogs.ts, suggestions.ts, live.ts, caret.ts, chrome.ts
```

## Decisions worth remembering

- **One place per rule.** Move legality lives in `src/shared/moves.ts` (`decideMove`,
  `exceedsDepth`); the keyboard, the phone toolbar, the board and the API all gather facts
  and ask it. Inside-itself, collaborator scope, invitation states, search matching and date
  recognition each have exactly one home (`mutations.ts`, `scope.ts`, `shares.ts`,
  `shared/search.ts`, `shared/dates.ts`).
- **Copies are placements.** A copy row carries `mirror_of`; its content and children come
  from the original, its parent, position and folding are its own. The display tree expands
  copies, so one real id can appear under the original and under each copy. Client rows are
  keyed by their path (`Node.key`), not by id.
- **Depth is the path depth.** `data-depth` counts placements from the outline root (from the
  shared bullet for a collaborator), so a copy's children sit one level below the copy.
- **Writes are serialised per outline.** Every write takes
  `pg_advisory_xact_lock(hashtext(owner_id))`, then the next sequence number, then writes a
  change row and appends it to `twig:outline:<owner>:changes` (entry id `<seq>-0`, fields
  `seq` and `change`). Fan-out happens only through Valkey, so when Valkey is down tabs show
  the paused banner and catch up from the `changes` table on resume.
- **The client refreshes rather than guesses.** Content changes are patched into the rows in
  place (so the caret and an open suggestions list survive); anything structural reloads the
  branch with `GET /api/outline` and restores focus and caret.
- **Text saving is a browser timer** (600 ms, plus Enter, blur and before any zoom or
  navigation). Saves carry the revision the tab last saw; a lower revision answers 409
  `stale_revision` with the current text and the winning editor's name.
- **Mail is our own SMTP dialogue** (`smtp.ts`) because nodemailer is MIT-0, which the
  licence rule does not allow. `send` resolves only once Mailpit has accepted, which is what
  "Sent" and the 202 from sign-up depend on.

## Checking changes

The services in this environment are live, so the quickest loop is: `npm run build`, restart
the server, then drive it with the API or a browser. Useful facts:

- Seeded people: `wren@pellwick.test` / `wren-branches-26` and `jonah@pellwick.test` /
  `jonah-branches-26`. Deleting the `%@pellwick.test` users and restarting re-seeds them.
- `POST /api/grading/setup` with `X-Grading-Key` builds people, outlines, copies and shares
  in one call and returns their ids by ref — the fastest way to set up a scenario.
- Config-dependent behaviour (depth limit, undo depth, trash window, invitation limit, mail
  outage, Valkey outage) is easiest to check by starting a second server on another port with
  the env values changed.
