# Spurline browser client

Preact 10 + esbuild. Entry `src/client/main.tsx`; the build writes `dist/public/app.js` and `dist/public/app.css`.

## What the server must provide

- Every GET page route (all rows of the brief's "Page routes" table, including unknown paths) answers the same HTML shell:
  ```html
  <!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>Spurline</title>
  <link rel="stylesheet" href="/app.css"></head>
  <body><div id="app"></div>
  <script type="application/json" id="spur-config">{"toastMs":5000,"user":{"id":1,"username":"ana","time_zone":"UTC"},"storage":"up"}</script>
  <script type="module" src="/app.js"></script></body></html>
  ```
  `user` is `null` when signed out; `storage` is `"up"` or `"down"`; `toastMs` is `SPUR_TOAST_MS`. Unauthenticated page
  requests redirect to `/sign-in` (the client also does it on a 401 answer, with `?next=`).
- `/app.js`, `/app.css` and `/fonts/<file>.woff2` as static files. No other origin is contacted.
- API routes used by the shell and the three real pages:
  - `GET /api/me/projects` -> `{"projects":[{"id","path","name","visibility","description"?}]}`
  - `GET /api/me/groups` -> `{"groups":[{"id","path","name"}]}`
  - `POST /api/session`, `POST /api/users`, `DELETE /api/session`, `PATCH /api/me` as in the brief (user objects carry `id`, `username`, `time_zone`)
  - `GET /api/projects/<id>` must include `my_role`, `my_permissions`, `path`, `name`, `default_branch` and `seq` (the project's current live
    sequence). `my_role` is the base role (`guest`..`owner`); `my_permissions` lists custom permissions.
- Live socket `GET /api/live?project=<id>&since=<seq>`. `since` is sent whenever the page knows a seq. Messages: `{seq,type,data}`;
  `{"type":"resync"}`; `{"type":"instance","data":{"storage":"up"|"down"}}` (no seq). Announcements ride in `data.say`:
  `[{text, to?: username, pages?: [page keys]}]`. A `role` message is `{type:"role", data:{username, path, role: string|null}}`;
  the client builds its own `Your role in <path> is now <role>.` / `You no longer have access to <path>.` announcements, so the
  server must not also put them in `say`.

## Map

| Area | Files |
|---|---|
| boot, routing | `main.tsx`, `app.tsx`, `router.ts`, `routes.ts` (route -> page file map at the top) |
| data | `api.ts` (api, ApiError, useResource, useAction, usePending), `live.ts`, `role.ts`, `session.ts`, `instance.ts`, `config.ts`, `store.ts` |
| announcements | `announce.tsx` (`announce(text)`, `<Announcer/>` rendered once by the shell) |
| a11y | `a11y/dialog.tsx` (Dialog, Sheet), `a11y/landmarks.ts` (F6), `a11y/keys.ts` (isTypingTarget) |
| shell | `shell/shell.tsx`, `strip.tsx`, `header.tsx`, `footer.tsx`, `main.tsx` (Main, LiveMain), `account.tsx`, `groups-dialog.tsx`, `search-form.tsx` |
| ui | `ui/index.ts` re-exports every primitive |
| styles | `styles/tokens.css`, `fonts.css`, `base.css`, `shell.css`, `components.css` |

## Conventions for pages

- Every page renders `<Main>` (or `<LiveMain project=...>`; `<Page title ...>` wraps either with the level 1 heading).
- CSS classes: `sp-<component>`, `sp-<component>__<part>`, `sp-<component>--<modifier>`. Colour comes from the semantic
  `--c-*` variables; `.sp-light` (band, cards) and `.sp-dark` switch them. Mark landmarks with `data-landmark="files"` / `"panel"`.
  The project home hero is `<section data-hero class="sp-hero-pull">` so the header can go see-through and turn light.
- Nothing a user action or live message needs may wait for a timer, rAF or `useEffect`: use handlers, promise continuations and
  `useLayoutEffect`.
