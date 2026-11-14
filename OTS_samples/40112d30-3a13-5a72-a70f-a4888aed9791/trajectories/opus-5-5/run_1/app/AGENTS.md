# Nightform repository notes

- Run manifest: `run.json` (`npm ci`, `npm run build`, `npm run start`). Server bundle is `dist/server.js`, client assets in `dist/public` (loaded into memory at boot, so restart the server after a rebuild).
- Server: `src/server` (plain `node:http` router in `http.ts`, routes registered from `auth.ts`, `builder.ts`, `respond.ts`, `owner.ts`, `grading.ts`). The one logic engine lives in `src/server/engine` (decimal, formula parser, evaluator, walk, checks).
- Client: vanilla TypeScript DOM in `src/client` (no framework; focus and announcements are set synchronously in the reply's task). Shared copy and types in `src/shared`.
- Time closing is derived (`withClock` in `forms.ts`); hand and limit closing are stored. Grading clock is an offset in the `app_clock` table, polled every 500 ms by `live.ts`.
- Tests: `npm run test:engine` (pure), `npm run test:api` (needs a running server on `APP_PUBLIC_PORT` and `GRADING_KEY`).
- No `ps`/`pkill` in the dev container: find server PIDs through `/proc/*/cmdline`.
