# Twinrow

Shared web workspace for knitting and crochet pattern designers. One chart is the
single source of truth: the server checks stitch arithmetic, writes instructions
from the chart, reads typed instructions back into the chart, and lets designers
edit together while testers work a saved version row by row.

## Services

- **Postgres** (`DATABASE_URL`) — every lasting record: accounts, patterns,
  cells, versions, testers, counters, notes.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`) — all mail.
- **Valkey** (`VALKEY_URL`) — presence, live chart updates and the shared row
  counter. A hand-written RESP client (`server/live/resp.ts`) bounded to one
  second per command talks to it; the app starts, serves and saves without it.

## Layout

- `common/` — shared domain: copy (every published string), symbols (the one
  symbol table), validate (field errors), types.
- `server/chart/` — the one place each domain rule is decided:
  `check.ts` (row rule, cable grouping, counts), `lines.ts` (written text and
  repeat detection), `grammar.ts` (the text grammar), `apply.ts` (typed text
  becomes cells).
- `server/` — routes, versions, testers, grading, the live hub, the PDF sheet
  writer (`server/pdf/sheet.ts`, no separate service).
- `client/` — React pages and components. The server owns every count, line and
  error; the browser renders them and never decides them.

## Working on this repo

- `npm run build` type-checks (strict) and bundles both sides to `dist/`.
- `npm run start` serves on `0.0.0.0:4173`, applying the schema idempotently.
- The test suites, all against a running server:
  - `npx tsx tools/domsmoke.ts` — the chart contract and keyboard behaviour.
  - `npx tsx tools/followtest.ts` — the follow page, counter and public page.
  - `npx tsx tools/comparetest.ts` — the compare page and its summary line.
  - `npx tsx tools/layouttest.ts` — the layout widths at 600 and 1024 px.
  - `npx esbuild tools/apitest.ts --bundle --platform=node --format=esm
    --outfile=/tmp/apitest.mjs && node /tmp/apitest.mjs` — the API end to end.
  - `npx esbuild tools/domaintest.ts --bundle --platform=node --format=esm
    --outfile=/tmp/domaintest.mjs && node /tmp/domaintest.mjs` — the chart
    engine against the brief's worked examples.
- The grading setup route (`POST /api/grading/setup`, header
  `X-Grading-Key: <GRADING_KEY>`) makes every person and pattern a check needs.

## Conventions

- Every published string lives in `common/copy.ts`; straight apostrophes, ASCII
  hyphens and three full stops only, never an ellipsis character.
- One domain rule, one home: if a count, a line or an error appears in two
  places, one of them is wrong.
- Copy tests read attributes and text, so the DOM contract (roles, names, data
  attributes) is load-bearing and must not be reshaped.
