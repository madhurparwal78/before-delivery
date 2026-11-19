# Third party notices

Wringbench ships the packages, fonts and icons listed here. Every one of them is published under
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib or OFL-1.1.

## Shipped packages

This is the production dependency tree (`npm ls --omit=dev --all --json`). The unmet optional
native add-ons of `pg` and `ws` (`pg-native`, `bufferutil`, `utf-8-validate`) are not installed and
not shipped.

| Package | Version | Licence |
|---|---|---|
| pako | 2.1.0 | MIT AND Zlib |
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
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

`pako` is bundled into the page's bake worker for Gzip and Gunzip. `pg` and `ws` run on the server
only.

## Bundled fonts

The font files under `/fonts` are copied at build time from the `@fontsource` packages
(build-time dependencies) and served from this origin only.

| Font | Source package | Version | Licence |
|---|---|---|---|
| Inter (weights 400, 500, 600, 700, Latin subset) | @fontsource/inter | 5.1.0 | OFL-1.1 |
| Fragment Mono (weight 400, Latin subset) | @fontsource/fragment-mono | 5.1.0 | OFL-1.1 |

Inter is copyright The Inter Project Authors. Fragment Mono is copyright The Fragment Mono Project
Authors. Both are licensed under the SIL Open Font License, Version 1.1.

## Bundled icons

| Icon set | Source package | Version | Licence |
|---|---|---|---|
| Lucide icons | lucide-static | 0.469.0 | ISC |

The icon markup is generated into `src/client/icons.generated.ts` at build time from
`lucide-static`. Lucide is copyright the Lucide Contributors; its ISC licence applies, along with
the original Feather copyright (© 2013-2022 Cole Bemis, MIT) for the icons inherited from Feather.

## Original artwork

The wrung-cloth mascot is an original SVG drawn for Wringbench and carries no third party licence.
