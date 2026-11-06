# Stillhour

A single-page scroll story and planner for the hour before bed. TypeScript throughout;
Express + PostgreSQL serve the API, a hand-rolled SMTP client sends to Mailpit, and the
browser builds every scene in code on one fixed canvas.

## Running

- `run.json` drives the manifest: `install` = `npm ci`, `build` = `npm run build`, `serve` = `npm start`.
- The server listens on `0.0.0.0:${APP_PUBLIC_PORT:-4173}` and creates its tables on boot.
- Configuration is read from the environment once at start: `DATABASE_URL`, `SMTP_HOST`,
  `SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`, `STILLHOUR_PUBLIC_ORIGIN`, `STILLHOUR_TEST_CLOCK`.
- `STILLHOUR_TEST_CLOCK=1` enables `PUT`/`DELETE /api/test/clock`, which freeze or clear the
  app clock (stored in the `test_clock` table) and run due reminders before answering.

## Layout

- `src/server` — API routes (`api.ts`), outbox (`outbox.ts`), reminder scheduler (`scheduler.ts`),
  SMTP client (`smtp.ts`), sessions, page templates (`pages.ts`).
- `src/shared` — plan rules (`plan.ts`), wall-clock engine (`time.ts`), the generated zone
  table (`zone-data.ts`), the one API error shape (`errors.ts`).
- `src/client` — story, manage, signin and partner pages, bundling to `public/app.js` with esbuild.
- `public` — styles, fonts, and generated media (film, ritual clips, audio).
- `scripts/make_media.py` — regenerates the film, clips and audio with Pillow/numpy + ffmpeg.
- `scripts/gen-timezones.mjs` — regenerates the zone transition table from Node's Intl.

## Domain rules decided in one place

- Field rules for a plan: `src/shared/plan.ts` (used by both server validation and the planner).
- Reminder due times, nights and clock-change handling: `src/shared/time.ts` (offsets from the
  shipped transition table; first occurrence wins on fall-back, first valid minute after a hole).
- Link expiry, idempotent replay, rate limits and the live count live in `src/server/api.ts`,
  `outbox.ts` and `scheduler.ts` respectively.
- The API error shape is `src/shared/errors.ts`; every route throws `ApiError` and nothing writes
  an error body by hand.

## Gotchas learned here

- `pg` 3.x has no `Pool` class; use `pg` 8.
- The server compiles to CommonJS (`tsconfig.server.json`) because the browser bundle stays ESM
  and `package.json` carries no `"type": "module"`.
- SMTP DATA bodies must dot-stuff content but send the terminating `.` separately, or the
  message never ends.
- Headless test drivers dispatch `mousemove` that is not a `PointerEvent`; pointer handlers must
  accept any event with numeric `clientX`/`clientY`.
- The story page uses smooth scrolling (`scroll-behavior: smooth`), so programmatic scrolls in
  tests need ~1.5 s to settle.
