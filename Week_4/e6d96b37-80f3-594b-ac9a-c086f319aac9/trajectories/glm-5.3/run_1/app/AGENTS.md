# Flan working desk — repository memory

## Status: complete and verified
The app builds (`npm ci` → `npm run build` → `npm run start`) and serves on :4173. The default namespace `hollowmint` seeds on serve with the brief's exact fixture: offer-0 accepted (O), offer-1 sent (C for X, 48-hour window), specimens A/B/C attributed, U quarantined, O outbound, X reserved-counterpart, Y outsider. Corner block reads "2 open offers", status line "Today: 0 specimens taken in. 0 catalog records pending."

## Verified journeys (Playwright against real Keycloak)
- Intake: staged photos → reference → review dialog → 201, MinIO writes confirmed, F_INTAKE_OK announced.
- Tray placement: pick holder, click cell, review → 200, F_TRAY_OK.
- Offer send with step-up: 403 step_up_required → staged resume → real Keycloak password+OTP pages → callback → resumed command 200, offer reserved A/X.
- All 14 grading workflows seed cleanly with genuine Keycloak sessions (dealer, dealer_peer, counterpart, outsider).

## Environment (verified)
- `/app` is the app root. Services: Keycloak 26.0.7 at `http://keycloak:8080` (realm `gf-dev`, client id `app` with secret in env), Postgres at `postgres:5432` (`DATABASE_URL`, db `gf_dev`), MinIO at `minio:9000` (bucket `gf-dev` exists), WireMock at `http://wiremock:8080`.
- WireMock register endpoints already live: `/catalog/varieties?reference=` (ALD-A/ALD-K/ALD-O), `/catalog/images/<ref>.svg`, `/catalog/albums?set=ALD-CROWN` (holes Mint A/K/O).
- The `app` client already exists in Keycloak with service account enabled (client_credentials works). Service account has realm-management manage-realm/manage-users.
- App user DB is in `gf_dev`; only `gf_app` role available. Keycloak's own DB is NOT reachable from this container.

## Keycloak 26 facts (verified by probing)
- Admin REST cannot create OTP credentials directly (no POST /users/{id}/credentials; put-credential only in 26.1+).
- Working TOTP provisioning procedure (server-side, no browser):
  1. Create user with password (credentials array works on create; `requiredActions: []`).
  2. Set user requiredActions `["CONFIGURE_TOTP"]`.
  3. Disable required actions VERIFY_EMAIL, UPDATE_PROFILE, UPDATE_PASSWORD, VERIFY_PROFILE so password grant works.
  4. Drive Keycloak's own login pages over HTTP with a cookie jar:
     - GET `/realms/{r}/protocol/openid-connect/auth?...` → parse `<form action=...>` (login-actions/authenticate).
     - POST username/password → 302 to `/login-actions/required-action?execution=CONFIGURE_TOTP...`.
     - GET that page → parse form action + `totpSecret` hidden field + QR data URI.
     - Decode the QR PNG (jsQR/pngjs) → `otpauth://totp/...?secret=<BASE32>&period=30`.
     - POST `totp=<current code>`, `totpSecret=<kc field>`, `userLabel`, `logout-sessions=on` → 302 to app callback. OTP credential created, requiredActions cleared.
  5. Keep the base32 secret; compute TOTP (HmacSHA1, 6 digits, period FLAN_TOTP_PERIOD_S) for the grading otp route.
- `otpPolicyCodeReusable=false` → each code works once; compute fresh at request time.
- With OTP configured, browser flow shows the OTP form after password (conditional-user-configured + auth-otp-form REQUIRED under `forms` flow) — the "real Keycloak one-time-code page".
- Direct grant also works with `otp` param (transient failures are time-based).
- Step-up: the browser flow always challenges OTP after password (users all have OTP). "Fresh" proof tracked by the app: app session's step_up_at timestamp within FLAN_STEPUP_TTL_S.
- User attributes: set `flan_namespace` on user creation.
- Realm roles: create `flan-dealer` / `flan-counterpart`, then GET /roles to find ids, POST /users/{id}/role-mappings/realm.
- Disable/enable user: PUT /users/{id} {enabled}. Sessions of a disabled user die automatically.
- Logout: use app cookie deletion; Keycloak end_session needs id_token.

## Decisions
- Server: Express 5 (Node 22, ESM, strict TS). `tsc -b` compiles `src/server`+`src/shared` to `dist-server`; Vite builds `src/app`.
- run.json: install `npm ci`, build `npm run build`, serve `npm run start` (node dist-server/server/main.js), port 4173/APP_PUBLIC_PORT.
- Photos validated by signature (JPEG/PNG/WebP magic; SVG/XML refused), dimensions from headers only (PNG IHDR, JPEG SOF scan, WebP VP8/VP8L/VP8X).
- App sessions in Postgres (`sessions` table), cookie `flan_session`. Namespace clocks: `namespace_clocks.offset_seconds` from FLAN_GRADE_CLOCK_ISO for grading namespaces; default namespace uses real time.
- WireMock register replies validated strictly; stored in `register_records` (image in MinIO under `catalog/<ns>/<ref>/r<rev>.svg`).
- TOTP seeding done at serve/seed time by driving Keycloak's own pages server-side (see procedure above).
- jsqr+pngjs (Apache-2.0/MIT) are production deps used to decode Keycloak's TOTP QR image.
- Keycloak claims: role from `realm_access.roles` in the introspected token; namespace derived from the seeded username `<ns>-<role>` because the service account cannot add protocol mappers (client admin API 403).
- Step-up: `/auth/step-up` re-runs the browser login with `prompt=login&max_age=0`, forcing password + OTP pages; the callback marks the session's step_up_at when the flow was a step-up. step_up_at is recorded in REAL time (freshness is real time per the brief); session expiry is namespace-clock time.
- Frontend resume: `src/app/resume.ts` stages a failing command in sessionStorage; DeskProvider re-sends it once after the session refreshes, announcing F_RESUMED.
- Fixture photos: procedural PNG generator in `src/server/fixture_media.ts` (rim, legend ring, portrait, mintmark at (600,400), optional scratch/gouge). Use `deflateSync` (NOT raw) for PNG IDAT.
- Photo ids include the face suffix (`ph_<sha18>o` / `ph_<sha18>r`) so identical obverse/reverse bytes do not collide on the photos PK.
- Default namespace seeds via `ensureDefaultNamespace()` in `src/server/main.ts` (tray_placement baseline + explicit offer-1 sent C-for-X insert).
