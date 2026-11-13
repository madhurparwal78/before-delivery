# Third-party notices

Keelson ships the packages, fonts and icon set listed below. Every entry is covered by one of
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, or SIL OFL 1.1 for fonts.

## Shipped npm packages

These are the production dependency tree as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence | Source |
|---|---|---|---|
| pg | 8.16.3 | MIT | https://github.com/brianc/node-postgres |
| pg-cloudflare | 1.4.1 | MIT | https://github.com/brianc/node-postgres |
| pg-connection-string | 2.14.1 | MIT | https://github.com/brianc/node-postgres |
| pg-int8 | 1.0.1 | ISC | https://github.com/charmander/pg-int8 |
| pg-pool | 3.14.0 | MIT | https://github.com/brianc/node-postgres |
| pg-protocol | 1.16.1 | MIT | https://github.com/brianc/node-postgres |
| pg-types | 2.2.0 | MIT | https://github.com/brianc/node-pg-types |
| pgpass | 1.0.5 | MIT | https://github.com/hoegaarden/pgpass |
| postgres-array | 2.0.0 | MIT | https://github.com/bendrucker/postgres-array |
| postgres-bytea | 1.0.1 | MIT | https://github.com/bendrucker/postgres-bytea |
| postgres-date | 1.0.7 | MIT | https://github.com/bendrucker/postgres-date |
| postgres-interval | 1.2.0 | MIT | https://github.com/bendrucker/postgres-interval |
| split2 | 4.2.0 | ISC | https://github.com/mcollina/split2 |
| xtend | 4.0.2 | MIT | https://github.com/Raynos/xtend |

Object storage requests are signed with AWS Signature Version 4 written against Node's own
`node:crypto`, and SMTP is spoken directly over `node:net`, so neither needs a package.

## Self-hosted fonts

All three families are served from the app's own origin as WOFF2 under
`dist/public/`, and none is fetched from an external host at runtime.

| Font | Weights shipped | Licence | Source |
|---|---|---|---|
| Space Grotesk | 500, 700 (latin, latin-ext) | SIL Open Font License 1.1 | https://github.com/floriankarsten/space-grotesk |
| IBM Plex Sans | 400, 600 (latin, latin-ext) | SIL Open Font License 1.1 | https://github.com/IBM/plex |
| IBM Plex Mono | 400, 500 (latin, latin-ext) | SIL Open Font License 1.1 | https://github.com/IBM/plex |

The WOFF2 files were taken from the Fontsource distributions of these families
(`@fontsource/space-grotesk`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, each
published under the SIL Open Font License 1.1) and are committed under `static/fonts/`.

## Icon set

| Set | Licence | Source |
|---|---|---|
| Lucide | ISC | https://github.com/lucide-icons/lucide |

The status glyphs, and the small set of control glyphs beside them, are Lucide outline icons
inlined as SVG path data in `src/client/icons.ts`:
`circle-check`, `arrow-right-left`, `triangle-alert`, `git-fork`, `circle-slash`,
`circle-dashed`, `menu`, `x`, `download`, `snowflake`, `rotate-ccw`, `shield-check`, `package`,
`play` and `clock`.

Lucide is a fork of Feather Icons, which is also ISC licensed
(https://github.com/feathericons/feather).
