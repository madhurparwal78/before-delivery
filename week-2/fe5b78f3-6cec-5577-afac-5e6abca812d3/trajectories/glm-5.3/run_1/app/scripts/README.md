# Test scripts

These are development-time checks; they are not part of the served app.

- `restart.sh` — stop any running server and start a fresh one on port 4173.
- `start-clock.sh` — start the server with `RAIL_CLOCK_START` and `RAIL_CLOCK_RATE`.
- `test-full.mjs` — backend scenario suite (allotment, quotas, options, promotion, caps).
- `test-chart.mjs` — phased chart scenario with clock restarts.
- `test-keyboard.js` — coach plan keyboard navigation (needs `playwright-core`).
- `axe-run.mjs` — WCAG 2.2 A/AA audit with axe-core (needs `playwright-core`
  and `axe-core` in node_modules; they are dev-only and not in the lockfile).

Run them against a running server: `node scripts/test-full.mjs`.
