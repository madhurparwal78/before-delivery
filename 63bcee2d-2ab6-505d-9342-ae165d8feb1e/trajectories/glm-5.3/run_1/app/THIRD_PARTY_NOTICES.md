# Third-party notices

Shipped packages are the lockfile's non-dev dependencies. Dev packages
(TypeScript, esbuild and type definitions) are build-time only and are not
shipped at runtime.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| express | 4.21.2 | MIT |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| pg | 8.13.1 (pg-protocol 1.10.1, postgres-array 2.0.0, postgres-bytea 1.0.0, postgres-int8 1.0.1, pg-connection-string 2.7.0, pg-pool 3.7.1, pg-types 2.2.0, pgpass 1.0.5, pg-cloudflare 1.2.6 (optional, skipped in this environment), pg-numeric 1.0.2, pg-int8 1.0.2, buffer-writer 1.0.1, packet-reader 1.3.1) | MIT (pgpass: MIT) |
| pngjs | 7.0.0 | MIT |

All transitive dependencies of the shipped packages declare MIT licences.

## Fonts

| Font | Version | Licence |
|---|---|---|
| Instrument Serif (Regular, Italic) | current release | SIL Open Font License 1.1 |
| Hanken Grotesk (Regular) | current release (variable) | SIL Open Font License 1.1 |

Fonts are served by the app itself; no runtime requests are made to any font host.

## Icons

| Set | Version | Licence |
|---|---|---|
| Lucide (inline icon paths for clock, check, cross, arrows, plus, upload, download, chevrons, send, pencil, trash) | 0.468.0 | ISC |
