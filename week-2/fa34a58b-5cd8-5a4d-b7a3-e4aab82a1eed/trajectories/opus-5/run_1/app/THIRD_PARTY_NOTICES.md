# Third party notices

Gablework Nightplan ships the packages and assets below. Every licence used is one of
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.

## Shipped packages

The production dependency tree as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
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
| ws | 8.18.0 | MIT |
| xtend | 4.0.2 | MIT |

`pg-cloudflare` is an optional dependency of `pg` and is listed above with its licence.
`pg` also declares the optional dependency `pg-native`, and `ws` declares the optional
dependencies `bufferutil` and `utf-8-validate`. None of those three is installed or
shipped, so `npm ls` reports them without a version. Their licences are MIT.

## Bundled fonts

Font files are served by the app from `/fonts/` and are never fetched from another origin.

| Font | Version | Licence | Files |
| --- | --- | --- | --- |
| Space Grotesk | 5.3.0 (`@fontsource/space-grotesk`) | OFL-1.1 | `space-grotesk-400.woff2`, `space-grotesk-500.woff2`, `space-grotesk-700.woff2` |
| IBM Plex Sans | 5.3.0 (`@fontsource/ibm-plex-sans`) | OFL-1.1 | `ibm-plex-sans-400.woff2`, `ibm-plex-sans-500.woff2` |
| JetBrains Mono | 5.3.0 (`@fontsource/jetbrains-mono`) | OFL-1.1 | `jetbrains-mono-400.woff2`, `jetbrains-mono-500.woff2` |

## Bundled icon set

| Icon set | Version | Licence | Use |
| --- | --- | --- | --- |
| Lucide | 1.66.0 (`lucide-static`) | ISC | The line icons inlined in `src/web/icons.ts` and drawn inside the app's own pages |

## Build-time tools

These are development dependencies. They are not shipped in the production dependency
tree and no part of them is served to the browser.

| Package | Version | Licence |
| --- | --- | --- |
| typescript | 5.7.2 | Apache-2.0 |
| esbuild | 0.24.2 | MIT |
| @types/node | 22.10.2 | MIT |
| @types/pg | 8.11.10 | MIT |
| @types/ws | 8.5.13 | MIT |
