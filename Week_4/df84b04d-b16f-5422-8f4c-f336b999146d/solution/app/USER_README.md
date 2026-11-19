# Twigline

Twigline is a web outliner. Each person keeps one outline of nested bullets, zooms into any bullet so its branch fills the page, mirrors a bullet into a second place as a live copy, searches with operators, views a branch as a board, and invites a collaborator onto a single branch without exposing the rest. Edits from every tab and every collaborator are applied in arrival order and appear live everywhere. Each person's own changes can be undone and redone from any tab. The outline leaves the account as plain text, Markdown or OPML downloads.

## Run it

`run.json` holds the three commands:

- install: `npm ci`
- build: `npm run build` (type-checks, builds the React frontend into `build/client`, bundles the server into `build/server.js`)
- serve: `node build/server.js` (foreground; binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173)

Seeded accounts: `wren@pellwick.test` / `wren-branches-26` and `jonah@pellwick.test` / `jonah-branches-26`.

## Services and environment variables

All configuration is read once, in `server/config.ts`.

| Service | Variables | Use |
|---|---|---|
| Postgres | `DATABASE_URL` | every durable record: accounts, bullets, shares, undo history, sequence numbers, change records |
| Valkey | `VALKEY_URL` | per-outline change streams `twig:outline:<owner id>:changes` for live fan-out and replay |
| Mailpit | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | sign-up codes and branch invitations |

Other variables: `APP_PUBLIC_URL` (links in email), `APP_PUBLIC_PORT`, `GRADING_KEY` (the grading setup route answers 404 when unset), `OUTLINE_TODAY`, `OUTLINE_TIME_ZONE`, and the limits `TWIG_CONFIRM_CODE_SECONDS`, `TWIG_INVITE_TTL_SECONDS`, `TWIG_TRASH_SECONDS`, `TWIG_UNDO_DEPTH`, `TWIG_STREAM_MAXLEN`, `TWIG_HEARTBEAT_SECONDS`, `TWIG_PAUSE_AFTER_SECONDS`, `TWIG_BULLET_MAX_CHARS`, `TWIG_MAX_DEPTH`, `TWIG_SEARCH_MAX_CHARS`.

The app starts when Valkey or Mailpit is unreachable: saves still commit, live sync shows its paused banner, invitations are stored as Not sent and sign-up answers 503.
