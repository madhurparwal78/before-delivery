# Flan — Hollowmint Desk Co.

Rare-coin dealer desk: specimen intake, attribution, tray/album, condition,
reciprocal swaps (offers, dispatch, receipt, disputes) and stock audit.

## Stack

- Backend: TypeScript on Node 22, plain `node:http` router. Deps kept tiny.
- Frontend: TypeScript + React 18, bundled with esbuild into `/static`.
- Postgres = system of record. MinIO = all photographs/evidence (private).
- Keycloak = sign-in + one-time-code step-up. WireMock = Varietal Coin Register.

## Environment facts (verified)

- `postgres:5432`, `minio:9000`, `keycloak:8080`, `wiremock:8080` all reachable.
- Serve port 4173 (`APP_PUBLIC_PORT`), `APP_PUBLIC_URL=http://127.0.0.1:4173`.
- `FLAN_GRADE_KEY` is set in the environment; grading routes are live.
- No other `FLAN_*` vars are set, so every limit falls back to its brief default.

### WireMock

- Register stubs are **pre-provisioned** by the environment. `ALD-A`/`ALD-K`/`ALD-O`
  varieties, `/catalog/images/<ref>.svg`, `/catalog/albums?set=ALD-CROWN` all answer.
  Unknown reference → 404 `{"error":"unknown_reference"}`.
- Admin API (`/__admin`) needs auth we do not hold. Per IF-05 the app never edits
  WireMock; it only consumes the register over HTTP. Tests install faults themselves.

### Keycloak (26.0.7) — step-up, the hard-won details

Realm `gf-dev`. Service account on client `app` holds `manage-realm`,
`manage-users`, `view-realm`, `view-users` — but **not** `manage-clients`. The
client list therefore reads empty, `POST /clients` is 403, and we never touch
client config. Client `app` is confidential and already accepts
`http://127.0.0.1:4173/auth/callback`.

Realm OTP policy is totp / period 30 / HmacSHA1 / 6 digits, matching the
`FLAN_TOTP_PERIOD_S` default.

**Verified facts, each of which cost a probe — do not re-litigate:**

1. `conditional-level-of-authentication` is **unusable here.** It fires whenever
   the current LoA is below the configured level, no matter what `acr_values` or
   essential `claims` the request carries (proved with configured levels 2, 3 and
   100 against requested 1, 2 and none). Translating a requested acr to a LoA
   needs the **client** attribute `acr.loa.map`; a realm-level `acr.loa.map` and
   `default.acr.values` do not drive it, and we cannot write client attributes.
2. The realm's declarative user profile has `unmanagedAttributePolicy` unset, so
   Keycloak **silently drops every undeclared user attribute.** Both
   `flan_namespace` and the step-up marker must be declared in
   `PUT /users/profile` or they vanish. This was the cause of a long
   "attribute condition never matches" dead end.
3. A flow's conditions are resolved **before** any of that flow's authenticators
   run, and `conditional-user-attribute` requires a user. So a conditional
   step-up subflow cannot live at the top level: on the first pass no user
   exists and Keycloak answers 400 "We are sorry...".
4. A **REQUIRED** sibling (and a CONDITIONAL one that resolves true) suppresses
   the whole ALTERNATIVE identity group in the same flow, which also breaks
   sign-in with a 400. So no extra top-level stage can be added either.
5. Writing an execution's requirement back (`PUT .../executions`) **resets its
   priority**, which silently reorders the flow. After changing a requirement,
   re-assert the order with `raise-priority` / `lower-priority`.
6. Subflows created through `POST .../executions/flow` are proper `basic-flow`s;
   passing `provider` is unnecessary. Newly added executions arrive `DISABLED`
   and appended last.
7. Keycloak stores the OTP secret as a raw string and HMACs **its UTF-8 bytes**
   (not base32-decoded) — confirmed by accepting offset 0 and rejecting the
   base32 reading. Codes follow Keycloak's real clock, and a code is single-use
   within its window, so always take a fresh code immediately before a challenge.

**Resulting design** (`rebuildStepUpFlow`): copy the built-in `browser` flow and
swap the condition inside its `forms` → `Browser - Conditional OTP` subflow from
`conditional-user-configured` to `conditional-user-attribute`
(`flan_step_up == requested`). The app sets that attribute just before a step-up
redirect and clears it on return.

- `/auth/login` → password only, level 1. Verified: no code is asked.
- `/auth/step-up` → `prompt=login` + `login_hint`, so Keycloak re-runs `forms`
  and then shows its provisioned one-time-code page (label "One-time code",
  field `otp`, submit `button[name=login]`). Verified: a live code is accepted.
- Known deviation: because a cookie-satisfied session cannot have an OTP leg
  injected (facts 3 and 4), the step-up shows the password page before the code
  page. Everything else about the challenge is Keycloak's own page.

### MinIO

- Bucket `gf-dev`, path-style. Unauthenticated access is 403 (stays private).
- S3 SigV4 is hand-rolled in `server/providers/storage.ts` to keep the shipped
  dependency tree small.

## Further Keycloak traps found while wiring the product

- There is **no** `POST /users/{id}/credentials`. A one-time-code credential can
  only be set in the user representation at creation. Reseeding must therefore
  leave an existing OTP credential alone, or delete and recreate the user.
- A **partial** `PUT /users/{id}` clears the realm's managed profile fields
  (email, firstName, lastName), which makes Keycloak demand VERIFY_PROFILE at
  the next sign-in and silently breaks step-up. Always merge into the current
  representation (`patchUser`).
- `flan_namespace` is **not** in any token: no protocol mapper emits it, and we
  cannot add one without `manage-clients`. The sign-in callback resolves the
  namespace through the admin API instead.

## Other traps

- `loadDesk` must be given the command's own transaction client, otherwise a
  reply is read on a second connection and cannot see the uncommitted write.
- A single `pg` client cannot run queries concurrently, so `loadDesk` reads
  sequentially rather than through `Promise.all`.
- `command_replies.body` is `NOT NULL`, so a 204 stores the JSON value `null`.
- Application sessions expire on the **namespace** clock, so a grading clock
  jump of hours legitimately ends them; sign in again after advancing.

## Layout

```
server/   config, providers (db, storage, keycloak, register), domain rules,
          http (errors, precedence, router, request, assets), store (state,
          events), routes (auth, reads, stock, exchange, disputes, grading),
          fixtures (procedural coin PNGs, seed, server-side sign-in)
client/   lib (api, desk context, drafts, layout, moves), shell (Desk, Home,
          Help, Review, Viewers, Icon), workspaces (one per published screen)
shared/   feedback.ts (the only copy registry) and types.ts
scripts/  build.mjs — copies fonts, inlines Lucide icons, bundles client+server
```

## Testing

Four throwaway harnesses live under `/tmp`; none ships. Together they are
**332 checks, all green** against the real HTTP API, the real Keycloak step-up
(live one-time codes) and the real register.

| Harness | Checks | What it covers |
|---|---|---|
| `/tmp/api_test.py` | 76 | tray, album, keepers, intake, reconcile, quarantine, audit, paging, replay |
| `/tmp/exchange_test.py` | 91 | step-up, send, reservations, acceptance, replacement, dispatch, receipt, transfer, disputes, links, window expiry |
| `/tmp/ui_test.mjs` | 126 | published roles and names, four viewports, targets, focus, drafts, zoom/wipe keys, live updates |
| `/tmp/journey.mjs` | 39 | the brief's journeys end to end in Chromium |

Run the Node ones from `/app` (module resolution) after
`npm install --no-save playwright@1.49.1`, then `npm ci` to restore a clean
tree — Playwright must not linger in `npm ls --omit=dev`.

Helpers: `/tmp/restart.sh` restarts the built server; `/tmp/login.py <user>
<password>` prints an application session cookie.

Gotchas when writing browser checks:

- The desk holds an SSE stream open, so `waitUntil: 'networkidle'` never
  settles. Wait for `#desk-main` instead.
- "Specimen A" appears both in the desktop stock grid and in a workspace's own
  candidate list, so scope chip locators to the pane under test.
- Keycloak refuses a one-time code twice in the same 30 s window; take a fresh,
  unspent code before each challenge.
- A grading clock jump of hours expires application sessions, so sign in again
  after advancing the clock.

## Conventions

- All feedback copy lives in exactly one registry: `shared/feedback.ts`, which
  both the server and the browser import. Never inline user-facing copy.
- Error precedence is stated once, in `server/http/precedence.ts`. Its phases
  are `check` (409 then 422) → `prepare` → `provide` (providers) → `commit`,
  which is what lets a catalogue correction survive a register outage and keeps
  provider errors out of the replay store.
- Domain transitions live under `server/domain/` — one rule, one place:
  `specimen.ts` (states, eligibility), `offer.ts` (transitions, version groups,
  windows), `holder.ts` (fit), `photo.ts` (signatures and limits),
  `validation.ts`, `clock.ts`.
- The published control names are used verbatim as accessible names in
  `client/`; `shared/types.ts` holds the workspace list and labels.

## Remaining gaps

- **Step-up shows a password page before Keycloak's one-time-code page.** This
  is forced by the platform constraints recorded above (facts 3 and 4) and the
  missing `manage-clients` grant. The code page itself is Keycloak's own, and a
  proof is recorded only after a real challenge.
- The desktop stock grid pages client-side over the already-loaded state; the
  server's cursor-paged `/specimens` route is implemented and tested but the
  grid does not yet call it, so very large desks would render every chip.
