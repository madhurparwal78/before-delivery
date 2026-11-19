# Third-party notices

Twigline ships the production dependency tree below (from `npm ls --omit=dev --all --json`),
two self-hosted fonts and its own icon set. Every licence is one of MIT, ISC, BSD-2-Clause,
BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| @ioredis/commands | 1.11.0 | MIT |
| cluster-key-slot | 1.1.2 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| ioredis | 5.4.1 | MIT |
| lodash.defaults | 4.2.0 | MIT |
| lodash.isarguments | 3.1.0 | MIT |
| ms | 2.1.3 | MIT |
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
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| standard-as-callback | 2.1.0 | MIT |
| ws | 8.18.0 | MIT |
| xtend | 4.0.2 | MIT |

`bufferutil`, `pg-native` and `utf-8-validate` are optional peers of `ws` and `pg`; they are
not installed and not shipped.

## Bundled fonts

| Font | Files | Licence |
| --- | --- | --- |
| Inter (variable, latin subset) | `public/fonts/inter-latin-var.woff2` | OFL-1.1 |
| Noto Sans (variable, latin subset) | `public/fonts/noto-sans-latin-var.woff2` | OFL-1.1 |

Copyright for Inter is held by The Inter Project Authors, and for Noto Sans by The Noto
Project Authors. Both are licensed under the SIL Open Font License, Version 1.1.

## Bundled icons

The line icons are original work, drawn as inline SVG paths in `src/client/dom.ts`, and are
part of this application under its MIT licence. No outside icon set is bundled, and no font,
script, style or image is loaded from another origin.

## Development-only tools

TypeScript and esbuild build the app and are not shipped to the browser or the server
runtime; both are Apache-2.0 and MIT respectively.
