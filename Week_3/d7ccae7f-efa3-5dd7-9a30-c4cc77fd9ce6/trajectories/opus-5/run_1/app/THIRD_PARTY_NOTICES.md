# Third-party notices

Lastbell ships the packages below, which are the whole production dependency tree
(`npm ls --omit=dev --all --json`), together with two fonts served from the app itself.
Build-time tools (TypeScript, Vite, type definitions) are development dependencies and
are not shipped.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| @ioredis/commands | 1.10.0 | MIT |
| cluster-key-slot | 1.1.1 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| ioredis | 5.11.1 | MIT |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| ms | 2.1.3 | MIT |
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
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| scheduler | 0.23.2 | MIT |
| split2 | 4.2.0 | ISC |
| standard-as-callback | 2.1.0 | MIT |
| three | 0.171.0 | MIT |
| xtend | 4.0.2 | MIT |

`pg` declares `pg-native` as an optional peer dependency. It is not installed and not shipped.

## Fonts

| Font | Files | Licence |
| --- | --- | --- |
| Fraunces | `public/fonts/fraunces-latin-wght-normal.woff2` | SIL Open Font License 1.1 (`public/fonts/fraunces-OFL.txt`) |
| Atkinson Hyperlegible | `public/fonts/atkinson-hyperlegible-latin-400-normal.woff2`, `public/fonts/atkinson-hyperlegible-latin-700-normal.woff2` | SIL Open Font License 1.1 (`public/fonts/atkinson-hyperlegible-OFL.txt`) |

Fraunces is Copyright 2020 The Fraunces Project Authors.
Atkinson Hyperlegible is Copyright 2020 Braille Institute of America, Inc.
