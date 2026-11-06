# Clapstick working notes

## Environment (verified)
- `/app` is the app root. Node v22.14.0, npm 10.9.2.
- Services reachable by host name: `postgres:5432` (DATABASE_URL in env),
  `minio:9000` (S3_* in env), `mailpit:1025` (SMTP_HOST/PORT) with API on
  `mailpit:8025`, `gotenberg:3000` (GOTENBERG_URL), `wiremock:8080`
  (WIREMOCK_URL). `APP_PUBLIC_URL=http://127.0.0.1:4173`,
  `APP_PUBLIC_PORT=4173`.
- WireMock baseline (do not touch): `GET /v2/tracks?q&cursor` returns the 3
  baseline tracks and `nextCursor:null`; `GET /v2/prices`; `POST /v2/licences`
  -> 201 `{"licenceId":"lic-501"}`; `POST /v1/renders` -> 202
  `{"id":"rnd-1","state":"queued"}` (always the same id, whatever the body);
  `GET /v1/renders/rnd-1` -> done with url `/files/rnd-1.bin` (28 bytes),
  size 28 and its sha256.
- psql is NOT installed; use node or curl for Postgres work.

## Build
- `run.json` = `npm ci` / `npm run build` / `npm run serve`.
- `npm run build` runs `scripts/build.mjs`: tsc --noEmit on `src/tsconfig.json`
  (which extends `/app/tsconfig.json`, include `src/**`), then esbuild bundles
  `src/server/main.ts`, `src/client/main.ts` and `src/shared/main.ts` to
  `build/<flavor>/index.js`, then copies woff2 fonts to `build/fonts/`.
- IMPORTANT: in build.mjs, invoke tsc as
  `execFileSync(process.execPath, [node_modules/typescript/bin/tsc, ...])` —
  plain `tsc` on PATH fails with status null under execFileSync here.
- Fonts were subset at setup time by `scripts/fonts.py` (fontTools) from
  Google Fonts variable TTFs into `assets/fonts/{libre-franklin,source-serif-4}`
  static weights (400/700 LF, 400/600/700 SS4), Arabic + Latin glyph coverage.
  Regenerate only with fontTools available.
- Shipped deps: @aws-sdk/client-s3, nodemailer. All licences MIT/Apache-2.0/0BSD/MIT-0.

## Domain arithmetic (all in src/shared, all checks pass: `node tools/checks.mjs`)
- Drop-frame 29.97: frame counts in the domain are DISPLAY INDICES (frames
  kept for display), i.e. index 1800 -> `00:01:00;02`, 17982 -> `00:10:00;00`.
  Dropped frame numbers 00/01 are simply never emitted. The worked table in
  the brief matches display indices exactly.
- `Rat.roundHalfUp` = floor((2n+d)/(2d)) on |n| (ties away from zero);
  `scaledHalfUp(p)` scales by 10^p then rounds. 120 frames at 23.976 =
  5.005 s -> "5.01 s".
- `convertFrames` uses exact rate ratios via `Rat` (25, 24000/1001, 30000/1001).
- `foldForCompare` lower-cases everything and folds accents; `foldAscii` keeps
  case, folds to printable ASCII else `_`. `ẞ` folds to `ss` in BOTH tables
  (capital sharp s is a small-letter fold: the brief prints `ẞ` -> `SS` in the
  EDL capital table BUT `Straẞe` -> `Strasse` in the worked example; the
  small table wins for the EDL case because `ẞ` is listed under small folds).
  NOTE: brief says `ẞ` becomes `SS` for EDL capitals; the `Strasse` example is
  the authoritative one for lowercase source. Keep `ẞ` in SMALL_FOLDS only.

## Gotchas hit so far
- esbuild `tsconfig` option must be a PATH string, not an object.
- execFileSync('tsc') fails oddly; use node + the tsc bin path.
- The terminal tool splits commands on newlines; use `&&` or `;`, not multi-line.
- Postgres wire protocol notes (src/server/db.ts implements it raw, no driver):
  - Auth is SCRAM-SHA-256; salted password = PBKDF2-HMAC-SHA256(password,
    salt, iters, 32). After the client final message comes R(12) server
    signature, then R(0) auth ok, then S* parameters, K, and Z. Consume
    through the Z before any query.
  - Bind body: cstring portal, cstring statement, int16 param format count,
    int16 param count, params (len+bytes), int16 result format count.
    A missing/extra int16 here gives "insufficient data left in message".
  - Describe: byte 'P' + cstring portal name. Execute: cstring portal + int32.
  - RowDescription per column: name cstring, table oid i32, attnum i16,
    type oid i32, typlen i16, typmod i32, format i16 — 18 bytes after the
    name. Missing typlen garbles later column names.
  - After an error response, drain the following Z before the next query.
  - Rows arrive as text; every value is a string (or null).


## Verified end state (2026-11-06)
- `node tools/checks.mjs`: 46 shared-arithmetic checks, all published worked
  examples (drop-frame table, real seconds, target frames, rate conversion,
  money split/tax, folding, EDL record starts).
- `python3 tools/smoke.py`: 54 API checks (sign-in/out/password, clients,
  desk boundaries, Ad-ID, paging cursor, folding search, board/cuts/undo,
  renders through WireMock to Ready, cues, private pages, wall-clock calls
  with the worked instants, enquiries limit, foreign origin, 404/405).
- `python3 tools/smoke2.py`: 41 API checks (script BOM+CRLF+quoted commas,
  sign-off journey, fee letter arithmetic, closing journey, line geometry,
  local number forms).
- Mail verified in Mailpit: review page mail, call mail with a correct
  calendar file (CRLF, 75-octet folding, stable UID, SEQUENCE growth,
  METHOD:REQUEST/CANCEL).
- THIRD_PARTY_NOTICES.md: 76 shipped packages, all MIT/Apache-2.0/0BSD/MIT-0,
  plus the two OFL-1.1 fonts (regenerate with `python3 tools/notices.py`).
- DP-50 verified: with S3_ENDPOINT, GOTENBERG_URL and WIREMOCK_URL pointed at
  broken addresses the app starts, serves health and answers the published
  outage copy (503 libraryUnavailable for a cue search).
