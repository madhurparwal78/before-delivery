# Third-party notices

This project ships the following third-party packages and fonts.

## Fonts (bundled under `src/server/static/fonts`)

| Font | Files | Licence | Source |
|---|---|---|---|
| Space Grotesk | space-grotesk-latin-400-normal.woff2, space-grotesk-latin-500-normal.woff2, space-grotesk-latin-600-normal.woff2, space-grotesk-latin-700-normal.woff2 | SIL Open Font License 1.1 (OFL-1.1) | Florian Karsten, via @fontsource/space-grotesk 5.3.0 |
| IBM Plex Sans | IBMPlexSans-Regular.woff2, IBMPlexSans-Medium.woff2 | SIL Open Font License 1.1 (OFL-1.1) | IBM Corp., via @ibm/plex 6.4.1 |
| IBM Plex Mono | IBMPlexMono-Regular.woff2, IBMPlexMono-Medium.woff2 | SIL Open Font License 1.1 (OFL-1.1) | IBM Corp., via @ibm/plex 6.4.1 |

## Production dependencies (the shipped dependency tree)

The application's only direct production dependency is `pg`, which talks to
PostgreSQL. Its transitive non-dev packages in the lockfile are:

| Package | Licence |
|---|---|
| pg | MIT |
| pg-cloudflare | MIT |
| pg-connection-string | MIT |
| pg-int8 | MIT |
| pg-pool | MIT |
| pg-protocol | MIT |
| pg-types | MIT |
| pgpass | MIT |
| postgres-array | MIT |
| postgres-bytea | MIT |
| postgres-date | MIT |
| postgres-interval | MIT |
| split2 | MIT |
| xtend | MIT |

## Development-only packages (not shipped; used only to build)

| Package | Licence |
|---|---|
| typescript | Apache-2.0 |
| esbuild | MIT |
| @types/node | MIT |
| @types/pg | MIT |

---

## SIL Open Font License 1.1 (applies to Space Grotesk, IBM Plex Sans, IBM Plex Mono)

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development and collaboration between designers, and to create a
shared and open framework in which fonts may be freely and openly
distributed, studied, modified, redesigned, improved and developed
in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any
reserved names are not used by derivative works. The fonts and
derivatives, however, cannot be released under any other type of
license. The requirement for fonts to remain under this license does
not apply to any document created using the fonts or derivatives.

(Full licence text: http://scripts.sil.org/OFL)
