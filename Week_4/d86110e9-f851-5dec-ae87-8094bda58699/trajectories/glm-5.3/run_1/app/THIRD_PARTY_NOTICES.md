# Third-party notices

This file lists every shipped package (the production dependency tree from
`npm ls --omit=dev --all --json`) and every bundled font file, with its
version and licence.

## Packages

| Name | Version | Licence |
|---|---|---|
| @fontsource/bricolage-grotesque | 5.2.8 | SIL OFL 1.1 |
| @fontsource/jetbrains-mono | 5.2.8 | SIL OFL 1.1 |
| @fontsource/schibsted-grotesk | 5.2.8 | SIL OFL 1.1 |
| aws4fetch | 1.0.20 | MIT |
| nodemailer | 10.6.0 | MIT-0 |
| pg | 8.16.1 | MIT |
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
| preact | 10.27.1 | MIT |
| split2 | 4.2.0 | ISC |
| typescript | 5.9.3 | Apache-2.0 |
| xtend | 4.0.2 | MIT |

(pg-native is an optional peer of pg and is not installed.)

## Bundled fonts

The app bundles woff2 files from the @fontsource packages above. Each font
family carries its own licence:

| Family | Files | Licence |
|---|---|---|
| Bricolage Grotesque | bricolage-grotesque-latin-400-normal.woff2, bricolage-grotesque-latin-700-normal.woff2 | SIL Open Font License 1.1 |
| Schibsted Grotesk | schibsted-grotesk-latin-400-normal.woff2, schibsted-grotesk-latin-500-normal.woff2, schibsted-grotesk-latin-700-normal.woff2 | SIL Open Font License 1.1 |
| JetBrains Mono | jetbrains-mono-latin-400-normal.woff2, jetbrains-mono-latin-500-normal.woff2 | SIL Open Font License 1.1 |
