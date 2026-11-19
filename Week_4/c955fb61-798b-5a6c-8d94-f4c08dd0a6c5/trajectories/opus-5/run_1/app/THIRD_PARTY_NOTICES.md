# Third party notices

Slackwater Plan ships the packages below. The list is the production dependency tree reported by
`npm ls --omit=dev --all --json`, plus the typeface the app serves itself.

## Shipped npm packages

| Package | Version | Licence |
| --- | --- | --- |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

`pg` declares `pg-native`, and `ws` declares `bufferutil` and `utf-8-validate`, as optional native
add-ons. None of them is installed or shipped.

## Shipped typeface

| Font | Source | Licence |
| --- | --- | --- |
| STIX Two Text | `@fontsource/stix-two-text` 5.3.0 (build-time only; the `latin` 400 and 500 woff2 files, regular and italic, are copied into the app's own assets) | OFL-1.1 |

STIX Two Text is published by the STI Pub companies under the SIL Open Font License, Version 1.1.

## Build-time only

These are development dependencies. They are not served to the browser and are not part of the
running app: `typescript` (Apache-2.0), `esbuild` (MIT), `@fontsource/stix-two-text` (OFL-1.1),
`@types/node`, `@types/pg` and `@types/ws` (all MIT).
