# Third-party notices

Teamseat ships the packages and fonts below. Everything else in `/app/src` is written for this
product. The package list is the production dependency tree reported by
`npm ls --omit=dev --all --json`; development-only tooling (TypeScript, Vite and their trees) is
not shipped and is therefore not listed.

## Shipped npm packages

| Package | Version | Licence |
| --- | --- | --- |
| busboy | 1.6.0 | MIT |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
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
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |
| streamsearch | 1.1.0 | MIT |
| xtend | 4.0.2 | MIT |

## Bundled fonts

Both families are served from this application's own origin, from `/fonts`.

| Font | Files | Licence |
| --- | --- | --- |
| Archivo (Omnibus-Type) | `public/fonts/archivo-latin-var.woff2` | SIL Open Font License 1.1 |
| Atkinson Hyperlegible (Braille Institute of America) | `public/fonts/atkinson-hyperlegible-latin-400.woff2`, `public/fonts/atkinson-hyperlegible-latin-700.woff2` | SIL Open Font License 1.1 |

### Licence texts

- MIT: <https://opensource.org/license/mit>
- ISC: <https://opensource.org/license/isc-license-txt>
- SIL Open Font License 1.1: <https://openfontlicense.org/open-font-license-official-text/>
