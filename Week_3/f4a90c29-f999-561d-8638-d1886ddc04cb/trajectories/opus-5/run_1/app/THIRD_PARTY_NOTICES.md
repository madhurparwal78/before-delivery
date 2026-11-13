# Third party notices

Every package shipped in Sundial & Wren's Wren Calendar, and the bundled font.

## Go modules the program imports

| Module | Version | Licence |
| --- | --- | --- |
| github.com/coder/websocket | v1.8.15 | ISC |
| github.com/jackc/pgx/v5 | v5.12.0 | MIT |
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/puddle/v2 | v2.2.3 | MIT |
| golang.org/x/sync | v0.22.0 | BSD-3-Clause |
| golang.org/x/text | v0.41.0 | BSD-3-Clause |

The Go standard library, including `time/tzdata`, is covered by the Go
BSD-3-Clause licence.

## npm packages

`npm ls --omit=dev --all` lists no production dependency: the front end is
written in TypeScript and bundled at build time, so nothing from npm is
shipped to the browser.

Build-only tools, which are not shipped:

| Package | Version | Licence |
| --- | --- | --- |
| esbuild | 0.25.0 | MIT |
| typescript | 5.7.3 | Apache-2.0 |

## Bundled font

| Font | Files | Licence |
| --- | --- | --- |
| Sora (variable) | `web/fonts/sora-latin-variable.woff2`, `web/fonts/sora-latin-ext-variable.woff2` | SIL Open Font License 1.1 |

The Open Font License text travels with the font in
`web/fonts/Sora-OFL.txt`. The font is served by this app from its own origin;
no page loads a script, style or font from anywhere else.
