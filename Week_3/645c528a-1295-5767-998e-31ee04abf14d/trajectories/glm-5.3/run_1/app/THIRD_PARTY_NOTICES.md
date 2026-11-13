# Third-party notices

This file lists every shipped package and bundled font, with name, version and
licence. Shipped packages are the production dependency tree
(`npm ls --omit=dev --all --json`) plus the bundled fonts below.

## Packages

| Name | Version | Licence |
|---|---|---|
| nodemailer | 10.3.1 | MIT-0 |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 4.1.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 3.0.4 | MIT |
| postgres-bytea | 3.0.0 | MIT |
| postgres-date | 2.1.0 | MIT |
| postgres-interval | 3.0.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

All licences above are among MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, CC0-1.0 and OFL-1.1.

## Fonts

| Name | Version | Licence |
|---|---|---|
| Big Shoulders Display (latin, variable weight) | 24 | OFL-1.1 |
| IBM Plex Sans (latin, variable weight) | 23 | OFL-1.1 |

Both font families are licensed under the SIL Open Font License 1.1 and are
served from this app's own origin; no asset is loaded from another origin.

The develop-time packages TypeScript and Node type definitions ship only in
`devDependencies` and are not part of the served production dependency tree.
