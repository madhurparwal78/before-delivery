# Third party notices

Seam ships the packages below, which are the production dependency tree reported
by `npm ls --omit=dev --all --json`, together with the two typefaces served from
`/fonts`. Build-only tooling (TypeScript, Vite, esbuild and the type packages)
is not shipped and is not listed here.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| @ioredis/commands | 1.11.0 | MIT |
| bufferutil | optional peer of `ws`, not installed | MIT |
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
| pg-native | optional peer of `pg`, not installed | MIT |
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
| utf-8-validate | optional peer of `ws`, not installed | MIT |
| ws | 8.18.0 | MIT |
| xtend | 4.0.2 | MIT |

## Typefaces

| Typeface | Files | Licence |
| --- | --- | --- |
| Gloock | `public/fonts/gloock-latin.woff2` | SIL Open Font License 1.1 |
| Rethink Sans | `public/fonts/rethink-sans-latin.woff2` | SIL Open Font License 1.1 |

Both typefaces are served from the app's own origin. Gloock is by Vasilis
Marmatakis and Rethink Sans is by Elliott Amblard; each is published under the
SIL Open Font License, Version 1.1, which is available at
<https://openfontlicense.org>.
