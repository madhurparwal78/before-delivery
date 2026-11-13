# Third party notices

Malhar Key-On ships the packages and fonts below. The package list is the production
dependency tree reported by `npm ls --omit=dev --all --json`. Development-only tools
(TypeScript, esbuild and type definitions) are not shipped and are not listed here.
`pg-native` appears in that tree only as an unmet optional dependency of `pg`; it is not
installed and not shipped.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| @ioredis/commands | 2.0.0 | MIT |
| cluster-key-slot | 1.1.1 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| ioredis | 6.0.0 | MIT |
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
| redis-errors | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| standard-as-callback | 2.1.0 | MIT |
| three | 0.187.0 | MIT |
| xtend | 4.0.2 | MIT |

## Bundled fonts

| Font | Files | Licence | Licence text |
|---|---|---|---|
| Gloock | `public/fonts/gloock-latin.woff2`, `public/fonts/gloock-latin-ext.woff2` | OFL-1.1 | `public/fonts/OFL-Gloock.txt` |
| Rethink Sans | `public/fonts/rethink-sans-latin.woff2`, `public/fonts/rethink-sans-latin-ext.woff2` | OFL-1.1 | `public/fonts/OFL-RethinkSans.txt` |

Both faces are served from this app only, from `/fonts/...`; no font is fetched from
Google or any other host at run time.

## Services

Postgres, Valkey, Gotenberg and ntfy are reached only through their published
interfaces at the addresses given in the environment. No other datastore is used.
