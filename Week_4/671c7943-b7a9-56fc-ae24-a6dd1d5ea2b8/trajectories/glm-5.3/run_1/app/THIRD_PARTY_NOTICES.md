# Third-party notices

This file lists every package shipped in the production dependency tree
(reported by `npm ls --omit=dev --all --json`), with its licence, plus the two
font families whose files the app serves.

## Packages

| Package | Version | Licence |
|---|---|---|
| @fontsource/instrument-sans | 5.3.0 | SIL Open Font License 1.1 |
| @fontsource/instrument-serif | 5.3.0 | SIL Open Font License 1.1 |
| nodemailer | 10.6.0 | MIT-0 (MIT) |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

`pg-native` is an optional dependency of `pg` and is not installed or shipped.

## Fonts

- **Instrument Serif** — supplied by `@fontsource/instrument-serif` under the
  SIL Open Font License 1.1.
- **Instrument Sans** — supplied by `@fontsource/instrument-sans` under the
  SIL Open Font License 1.1.

The app serves the woff2 files itself from `/fonts/`.
