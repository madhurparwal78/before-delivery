# Third-party notices

Holmgarth Aftercare Fittings Desk ships the packages and assets listed here. Every one is
under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
|---|---|---|
| busboy | 1.6.0 | MIT |
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
| streamsearch | 1.1.0 | MIT |
| xtend | 4.0.2 | MIT |

`busboy` and `streamsearch` are Copyright Brian White and are distributed under the MIT
licence. The `pg` family is Copyright Brian Carlson and contributors.

## Bundled typefaces

The typefaces ship with the desk and are served from its own origin, never fetched from
another site. Both the `latin` and `latin-ext` subsets are bundled, so Polish diacritics
render from the same files.

| Typeface | Source package | Version | Licence |
|---|---|---|---|
| Space Grotesk | @fontsource/space-grotesk | 5.1.0 | OFL-1.1 |
| IBM Plex Sans | @fontsource/ibm-plex-sans | 5.1.1 | OFL-1.1 |
| IBM Plex Mono | @fontsource/ibm-plex-mono | 5.1.1 | OFL-1.1 |

Space Grotesk is Copyright Florian Karsten. IBM Plex is Copyright IBM Corp. Both are
licensed under the SIL Open Font License, Version 1.1.

## Icons

| Asset | Source package | Version | Licence |
|---|---|---|---|
| Lucide icons | lucide-static | 0.468.0 | ISC |

Lucide icon outlines are inlined into the desk's own markup. Copyright for portions of
Lucide is held by Cole Bemis 2013-2022 as part of Feather (MIT); all other copyright is
held by Lucide Contributors 2022, under the ISC licence.

## Build-time tools

These are development dependencies. They are not part of the shipped tree and none of
their code is served, but they are named here for completeness.

| Package | Version | Licence |
|---|---|---|
| esbuild | 0.24.2 | MIT |
| typescript | 5.7.2 | Apache-2.0 |
| @types/busboy | 1.5.4 | MIT |
| @types/node | 22.10.2 | MIT |
| @types/pg | 8.11.10 | MIT |
