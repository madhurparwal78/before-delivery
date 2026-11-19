# Third-party notices

Lanternfold Rooms ships the packages, fonts and icons listed here. Shipped packages are the
production dependency tree reported by `npm ls --omit=dev --all --json`.

Regenerate this file with `node scripts/notices.mjs`.

## Packages

| Package | Version | Licence |
| --- | --- | --- |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg | 8.23.1 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| react-dom | 18.3.1 | MIT |
| react | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

19 packages in total.

## Fonts

The font files are vendored into the build from the packages named below, which are build-time
dependencies and are not part of the production dependency tree. Both the web fonts the browser
loads and the TrueType faces embedded in the recap PDF come from these families.

| Font | Licence | Author | Source package |
| --- | --- | --- | --- |
| IBM Plex Sans | OFL-1.1 | IBM | `@fontsource/ibm-plex-sans` |
| IBM Plex Mono | OFL-1.1 | IBM | `@fontsource/ibm-plex-mono` |
| Instrument Serif | OFL-1.1 | Rodrigo Fuenzalida and Natanael Gama | `@fontsource/instrument-serif` |

## Icons

| Icon set | Licence | Source package |
| --- | --- | --- |
| Lucide | ISC | `lucide-static` |

Lucide is a community fork of Feather Icons, © 2013–2022 Cole Bemis and © 2022 Lucide
Contributors, used under the ISC licence.
