# Third party notices

Mullion ships the production dependency tree below (`npm ls --omit=dev --all`). Build-only
packages (TypeScript, esbuild and type definitions) are development dependencies and are not
shipped. No font, script, stylesheet or image is loaded from another origin.

| Package | Version | Licence |
| --- | --- | --- |
| @ioredis/commands | 1.11.0 | MIT |
| cluster-key-slot | 1.1.2 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| ioredis | 5.4.2 | MIT |
| lodash.defaults | 4.2.0 | MIT |
| lodash.isarguments | 3.1.0 | MIT |
| ms | 2.1.3 | MIT |
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
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| standard-as-callback | 2.1.0 | MIT |
| ws | 8.18.0 | MIT |
| xtend | 4.0.2 | MIT |

`pg` declares `pg-native` and `ws` declares `bufferutil` and `utf-8-validate` as optional
dependencies. They are not installed and therefore not shipped.
