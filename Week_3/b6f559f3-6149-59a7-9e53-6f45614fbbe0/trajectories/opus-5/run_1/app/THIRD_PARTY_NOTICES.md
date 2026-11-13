# Third-party notices

Halation Studio ships the production dependency tree below, taken from
`npm ls --omit=dev --all --json`. Every package is used under the licence listed.

| Package | Version | Licence |
| --- | --- | --- |
| `lucide` | 0.439.0 | ISC |
| `pg` | 8.12.0 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `xtend` | 4.0.2 | MIT |

`lucide` provides the bundled icon set. `pg` and its dependencies provide the
PostgreSQL client. Object storage is reached with AWS Signature Version 4
requests built in `src/server/storage.ts`, and mail is sent with the small SMTP
client in `src/server/smtp.ts`, so no further runtime packages are shipped.

Build-time packages (`typescript`, `esbuild`, `@types/*`) are development
dependencies and are not shipped.
