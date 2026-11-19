# Third party notices

Afterglass ships the production dependency tree below (`npm ls --omit=dev --all --json`) and the
bundled fonts below. Development-only tools (TypeScript, esbuild, type definitions) are not shipped.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| @ioredis/commands | 1.4.0 | MIT |
| busboy | 1.6.0 | MIT |
| cluster-key-slot | 1.1.2 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| fflate | 0.8.3 | MIT |
| ioredis | 5.8.2 | MIT |
| js-tokens | 4.0.0 | MIT |
| lodash.defaults | 4.2.0 | MIT |
| lodash.isarguments | 3.1.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| lucide-react | 0.544.0 | ISC |
| ms | 2.1.3 | MIT |
| pg | 8.16.3 | MIT |
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
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| scheduler | 0.23.2 | MIT |
| split2 | 4.2.0 | ISC |
| standard-as-callback | 2.1.0 | MIT |
| streamsearch | 1.1.0 | MIT |
| xtend | 4.0.2 | MIT |

`pg` declares `pg-native` as an optional dependency. It is not installed and not shipped.

## Bundled fonts

Served from the app itself at `/fonts`, taken from the Fontsource packages of the same names.

| Font | Version | Licence |
| --- | --- | --- |
| Arimo (regular 400, bold 700, latin) | 5.3.0 | OFL-1.1 |
| PT Sans (regular 400, bold 700, latin) | 5.3.0 | OFL-1.1 |
| JetBrains Mono (regular 400, latin) | 5.3.0 | OFL-1.1 |

## Icons

Icon outlines come from Lucide (`lucide-react` 0.544.0), under the ISC licence.
