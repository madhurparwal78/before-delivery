# Ebbstone Marine Slackwater

Tidal-window planning, pilot rota, boarding-ladder reports and tariff billing for the harbour
pilot station at the invented Port Ansell. Node.js 22, strict TypeScript, React, one embedded
file store, with Kill Bill for charges and invoices, MinIO for evidence files and Mailpit for mail.

## Run it

```
npm ci          # install
npm run build   # tsc --noEmit, then esbuild bundles the server and the client
npm run serve   # binds 0.0.0.0 on APP_PUBLIC_PORT (4173 by default)
```

`/app/run.json` holds the same three commands. `GET /api/health` answers 200 whatever the state of
the providers. Each serving instance keeps its store at `data/slackwater-<port>.json`, seeded on
first serve; delete the file to reseed.

Provider credentials and URLs come only from the environment: `KILLBILL_*`, `S3_*`, `SMTP_HOST`,
`SMTP_PORT`, `MAIL_FROM` and the optional `DETENTION_UNIT_SECONDS`.

## Layout

| Path | What lives there |
| --- | --- |
| `src/domain/` | The published rules, shared by the server and the browser: `porttime.ts` (America/Halifax, real elapsed time, existing 5-minute steps), `tide.ts` (cosine interpolation), `plan.ts` (leg speed, arrival, squat, clearance, pinch, windows), `numerals.ts`, `tariff.ts`, `rest.ts`, `notice.ts`, `moves.ts` (state machine), `csv.ts`, `defects.ts`, `route.ts` |
| `src/server/` | `http.ts` (routing, limits, static files, origin check), `routes.ts` (the API table), `ops/` (move, assignment, evidence, accounts, tide, export operations), `derive.ts`, `views.ts`, `charges.ts`, `notices.ts`, `steps.ts` (pending steps), `store/` (file store, seed, record types), `providers/` (Kill Bill, MinIO over SigV4, SMTP, service state) |
| `src/web/` | `main.tsx` (shell, routing), `screens/`, `parts/` (`KeelSection`, `SectionDrawing`, `WaypointTable`, `AssignPanel`, `LadderReportDialog`, `Panel`), `api.ts`, `format.ts`, `hooks.ts`, `styles.css` |
| `scripts/` | `build.mjs`, `notices.mjs` (writes `THIRD_PARTY_NOTICES.md`), and the `check-*` verification scripts |

## Rules worth remembering

- Every duration is real elapsed time. A repeated local time means its first occurrence; a skipped
  local time has no instant at all. `porttime.ts` is the only place that converts.
- The clearance formula, leg arrivals, the rest verdict, the notice cutoff, each tariff line and the
  export cell encoding each live in exactly one module. The browser renders the server's result for
  commit, notice, photo and billing state.
- Money is whole cents, depths and margins whole millimetres. Rounding happens only at the
  published stage.
- Route handlers do their checks in the published precedence: 401, 404, 403, idempotent replay,
  428/412, 409, 422, then `stale_plan` and `window_closed`.
- Store changes run inside `store.mutate(...)` with no `await` inside, so each transition is atomic
  and simultaneous requests give exactly one success.
- Provider work happens in recorded steps (`charge_post`, `invoice_commit`, `notice_send`), retried
  every 15 seconds and run exactly once, so an outage leaves a truthful pending state.

## Checks

```
node --experimental-strip-types scripts/check-domain.ts   # published worked examples
node --experimental-strip-types scripts/check-csv.ts      # export, night window, detention, cutoffs
python3 scripts/check-turn.py                             # turn, override, skip, ladder notice (needs a running instance)
CHECK_PORT=4190 DETENTION_UNIT_SECONDS=10 python3 scripts/check-tide-detention.py
```

The browser journeys were driven with Playwright against a built instance: board planning and
commit, keyboard-only planning, clock-change steps, agency isolation, the ladder report from a
phone, notice cutoffs, invoicing, reduced motion, the board link, lost replies and touch dragging.
