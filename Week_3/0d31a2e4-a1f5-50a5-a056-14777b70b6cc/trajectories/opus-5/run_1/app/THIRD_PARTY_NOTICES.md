# Third-party notices

Pratfall Cup ships the packages and fonts below. Everything else in `devDependencies`
is build or test tooling and is not served to browsers: after `npm run build`,
`npm prune --omit=dev` leaves an app that still serves the same pages.

## Shipped packages

These are the packages listed under `dependencies` in `/app/package.json`, together with
every package they depend on in turn, as installed.

| Package | Version | Licence |
| --- | --- | --- |
| `lucide-react` | 0.469.0 | ISC |
| `pg` | 8.13.1 | MIT |
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
| `react` | 19.0.0 | MIT |
| `react-dom` | 19.0.0 | MIT |
| `scheduler` | 0.25.0 | MIT |
| `three` | 0.171.0 | MIT |
| `ws` | 8.18.0 | MIT |
| `xtend` | 4.0.2 | MIT |

Allowed package licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0.

`ws` and `pg` name `bufferutil`, `utf-8-validate` and `pg-native` as optional native
add-ons. None of them is installed, so none of them ships.

## Shipped fonts

The font files live in `/app/public/fonts` and are copied into the build output. They are
served from this origin only; no font is fetched from a third-party host.

| Family | File | Licence |
| --- | --- | --- |
| Bricolage Grotesque | `public/fonts/bricolage-grotesque-latin.woff2` | OFL-1.1 |
| Atkinson Hyperlegible | `public/fonts/atkinson-hyperlegible-latin-400.woff2` | OFL-1.1 |
| Atkinson Hyperlegible | `public/fonts/atkinson-hyperlegible-latin-700.woff2` | OFL-1.1 |
| Atkinson Hyperlegible Mono | `public/fonts/atkinson-hyperlegible-mono-latin.woff2` | OFL-1.1 |

Allowed font licence: OFL-1.1.

Bricolage Grotesque is © 2022 The Bricolage Project Authors. Atkinson Hyperlegible and
Atkinson Hyperlegible Mono are © Braille Institute of America, Inc. Both families are
licensed under the SIL Open Font License, Version 1.1.

## Icons

Icon artwork comes from `lucide-react` (ISC), listed above.
