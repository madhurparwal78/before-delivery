# Third-party notices

Tidemark Daybook ships the packages and fonts listed below. Everything here is served
from the app's own origin; the running app makes no third-party requests.

## Shipped packages

The production dependency tree, from `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.6 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |

`pg-native` appears in `pg`'s manifest as an optional peer dependency. It is not
installed and not shipped.

Build-only tools (TypeScript, esbuild and the `@types/*` packages) are development
dependencies. They are not part of the shipped tree and nothing from them is served.

## Bundled fonts

Served from `/fonts`, subset to Latin.

| Font | Version | Licence |
| --- | --- | --- |
| Fraunces (variable, 9–144 opsz, 400–700 wght) | Google Fonts release 2024-05-02 | OFL-1.1 |
| IBM Plex Sans (400, 600) | Google Fonts release 2024-05-02 | OFL-1.1 |
| IBM Plex Mono (400, 600) | Google Fonts release 2024-05-02 | OFL-1.1 |

Fraunces is © The Fraunces Project Authors (https://github.com/undercasetype/Fraunces).
IBM Plex Sans and IBM Plex Mono are © IBM Corp. (https://github.com/IBM/plex).
Both are licensed under the SIL Open Font License 1.1.

## Bundled icons

| Set | Version | Licence |
| --- | --- | --- |
| Lucide (grip-vertical, x, copy, refresh-cw, trash, chevron-left, chevron-right, upload, calendar, plus) | 0.468.0 | ISC |

Lucide is © Lucide Contributors (https://github.com/lucide-icons/lucide). The icon paths
are inlined in the browser bundle, so no icon package is installed or served separately.
