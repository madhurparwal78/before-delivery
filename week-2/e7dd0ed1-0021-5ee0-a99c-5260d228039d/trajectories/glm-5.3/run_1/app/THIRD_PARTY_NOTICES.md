# Third-party notices

Farshore ships the following third-party packages, fonts and data, each under one of the allowed licences (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, OFL-1.1).

## npm packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`:

| Package | Version | Licence |
|---|---|---|
| @aws-sdk/client-s3 | 3.1161.0 | Apache-2.0 |
| @aws-sdk/checksums | 3.1002.1 | Apache-2.0 |
| @aws-sdk/core | 3.979.1 | Apache-2.0 |
| @aws-sdk/types | 3.975.0 | Apache-2.0 |
| @smithy/core | 3.38.1 | Apache-2.0 |
| @smithy/types | 4.19.0 | Apache-2.0 |
| tslib | 2.9.1 | 0BSD |
| @aws-sdk/xml-builder | 3.972.42 | Apache-2.0 |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 |
| @smithy/signature-v4 | 5.7.5 | Apache-2.0 |
| bowser | 2.15.0 | MIT |
| @aws-sdk/credential-provider-node | 3.972.92 | Apache-2.0 |
| @aws-sdk/credential-provider-env | 3.972.80 | Apache-2.0 |
| @aws-sdk/credential-provider-http | 3.972.82 | Apache-2.0 |
| @smithy/fetch-http-handler | 5.8.0 | Apache-2.0 |
| @smithy/node-http-handler | 4.14.1 | Apache-2.0 |
| @aws-sdk/credential-provider-ini | 3.973.25 | Apache-2.0 |
| @aws-sdk/credential-provider-login | 3.972.87 | Apache-2.0 |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 |
| @aws-sdk/credential-provider-process | 3.972.80 | Apache-2.0 |
| @aws-sdk/credential-provider-sso | 3.973.24 | Apache-2.0 |
| @aws-sdk/credential-provider-web-identity | 3.972.86 | Apache-2.0 |
| @aws-sdk/signature-v4-multi-region | 3.996.51 | Apache-2.0 |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 |
| @aws-sdk/token-providers | 3.1161.0 | Apache-2.0 |
| @aws-sdk/middleware-sdk-s3 | 3.972.85 | Apache-2.0 |
| nodemailer | 6.8.0 | MIT-0 |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-native | not installed (optional) | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |

(pg-native is an optional dependency of pg and is not installed in this deployment.)

## Fonts

| Font | Files | Licence |
|---|---|---|
| Space Grotesk | space-grotesk-400.woff2, space-grotesk-500.woff2, space-grotesk-700.woff2 | OFL-1.1 |
| IBM Plex Sans | plex-sans-400.woff2, plex-sans-500.woff2, plex-sans-600.woff2, plex-sans-700.woff2 | OFL-1.1 |
| JetBrains Mono | jetbrains-mono-400.woff2, jetbrains-mono-500.woff2, jetbrains-mono-700.woff2 | OFL-1.1 |

All fonts are bundled under the SIL Open Font License, Version 1.1, and served from this app's own origin.

## Icons

No third-party icon set is shipped; all glyphs used in the interface are drawn inline or rendered as text.
