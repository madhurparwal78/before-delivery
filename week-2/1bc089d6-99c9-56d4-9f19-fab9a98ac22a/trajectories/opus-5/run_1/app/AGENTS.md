# Stillhour — repository notes

A single-page scroll story and planner for the hour before bed. TypeScript throughout:
a Node HTTP server on PostgreSQL, and a browser story drawn on one WebGL canvas.

## Layout

```
run.json                  install / build / serve (run-manifest-v1)
src/shared/               rules and shapes used by both sides
  rituals.ts              the fixed ritual catalogue
  plan.ts                 the published plan shape, grapheme counting, starts_at_local
  planRules.ts            every plan field rule, in one place
src/server/
  index.ts                http server, route table, boundary order
  config.ts               the environment, read once at start
  db.ts                   pg pool, schema, the Unavailable signal
  clock.ts                the app clock (real time, or the frozen test clock in the database)
  errors.ts               the single published error catalogue
  http.ts                 origin, media type, size and JSON checks; the reply writer
  static.ts               the built pages and assets, byte ranges, the 404 page
  domain/                 hours, drafts, links, sessions, share, idempotency, rate limits,
                          reminders, outbox, smtp, mail templates, zone arithmetic
  routes/                 one file per group of endpoints
src/client/
  index.html + story.ts   the long evening
  manage.html + manage.ts, signin, partner, privacy
  modules/                gate, audio, scroll, readouts, letters, numbers, breathing,
                          film, cards, planner, planFields, store, api, copy
  modules/scenes/         six scenes built in code on one canvas, plus the flat fallback
public/                   fonts, audio, film, ritual clips, posters, captions, favicon
tools/                    dev-time only: media builders, notices, four check harnesses
```

## Where each rule lives

| Rule | File |
| --- | --- |
| Plan field rules | `src/shared/planRules.ts` (+ required/extra keys in `server/domain/planRules.ts`) |
| Hour state transitions | `server/domain/hours.ts` |
| Reminder night and due time | `server/domain/zone.ts` + `server/domain/reminders.ts` |
| Link expiry and single use | `server/domain/links.ts` |
| Live count | `server/domain/hours.ts` (`liveCount`) |
| Idempotent replay | `server/domain/idempotency.ts` |
| Rate limits | `server/domain/rateLimit.ts` |
| Error bodies | `server/errors.ts` |
| Boundary order | `server/http.ts` + the route table in `server/index.ts` |

## Checking the work

The server must be running (`npm run start`) with Postgres and Mailpit reachable.

```
node tools/check-api.mjs      # 158 API checks against a live server
node tools/check-ui.mjs       # 177 browser checks (Chromium, three viewports, reduced motion)
node tools/check-outage.mjs   # database and mail taken away and brought back, via TCP proxies
node tools/check-cluster.mjs  # two instances, one database: one clock, one reminder
```

The browser harness needs Chromium once: `npx playwright install chromium`. Installing the
packages never downloads a browser, so `npm ci` stays quick.

`npm run media` regenerates the film, the ritual clips and the audio from code; the results are
committed under `public/`, so a normal build never needs ffmpeg.

## Decisions worth remembering

- **Readouts never wait for the canvas.** The story clock, window counter, dial, settle line
  and card travel are updated in the `scroll` handler, not in the animation frame, so they
  settle within a tenth of a second even when software WebGL makes frames slow. The canvas
  skips identical frames, skips drawing while an opaque chapter covers it, and lowers its own
  pixel ratio when a frame costs more than 26 ms.
- **The gate is a plain `role="dialog"` overlay**, not `<dialog>`, so focus can move to the hero
  heading while the gate fades. The page behind it is `inert` until a choice is made.
- **`/signin` keys its copy off `confirmed`.** The API's verify answer cannot say which kind of
  token it was (a sign-in token for a keeper also answers `confirmed: true`), so the page shows
  the confirmed copy whenever `confirmed` is true and "You are signed in." otherwise.
- **No nodemailer.** `server/domain/smtp.ts` speaks plain SMTP so every shipped package stays
  inside the allowed licence set (nodemailer is MIT-0).
- **Reminders are processed before any plan is serialised**, so `next_reminder_at` is exact on
  every read rather than up to 30 seconds stale.
- **One draft per save, never deleted on confirmation**, because emailed links cascade from
  drafts and a used link must keep answering `410 link_used`.
