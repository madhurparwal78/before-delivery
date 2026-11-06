# Checks

Local walks through the brief's journeys against a running server. They are
development tooling, not part of the app.

- `verify.sh` — resets Postgres and Mailpit, serves the build, then runs every suite.
- `instances.sh` — serves the same build as the extra grading instances on later ports.
- `e2e.ts` — sign-in, roles, seed data, clock-change days, booking, races, cancellation.
- `e2e2.ts` — working a day: visits, photos, marks, closes, invoices, dunning, money.
- `races.ts` — last-slot races, hold lapse, outages, allowances, imports, audit.
- `ui.mjs` — the screens in Chromium: keyboard booking, the axis wipe, layouts, motion.
  It needs Playwright installed outside this repository.
