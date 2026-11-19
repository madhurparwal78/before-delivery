# Third-party notices

This file lists every package shipped with Sprigmap, with its licence,
together with the bundled fonts.

## Shipped npm packages

The production dependency tree from `npm ls --omit=dev --all --json`:

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |
| ws | 8.22.2 | MIT |

The optional peers `pg-native`, `bufferutil` and `utf-8-validate` are
not installed and are not shipped.

All licences above are MIT or ISC, which are on the permitted list.

## Bundled fonts

The Figtree variable font (`src/client/fonts/figtree-vf.ttf`) is
bundled with the app and served by it. Figtree is available under the
SIL Open Font License 1.1; the licence text is bundled alongside the
font as `src/client/fonts/OFL.txt` and copied to
`client/fonts/OFL.txt` at build time.
