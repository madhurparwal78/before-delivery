# Third-party notices

Lightfall ships the following production packages (the `npm ls --omit=dev --all` tree) and bundled fonts.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| @aws-sdk/client-s3 | 3.1161.0 | Apache-2.0 |
| @aws-sdk/core | 3.979.1 | Apache-2.0 |
| @aws-sdk/checksums | 3.1002.1 | Apache-2.0 |
| @aws-sdk/credential-provider-env | 3.972.80 | Apache-2.0 |
| @aws-sdk/credential-provider-http | 3.972.82 | Apache-2.0 |
| @aws-sdk/credential-provider-ini | 3.973.25 | Apache-2.0 |
| @aws-sdk/credential-provider-login | 3.972.87 | Apache-2.0 |
| @aws-sdk/credential-provider-node | 3.972.92 | Apache-2.0 |
| @aws-sdk/credential-provider-process | 3.972.80 | Apache-2.0 |
| @aws-sdk/credential-provider-sso | 3.973.24 | Apache-2.0 |
| @aws-sdk/credential-provider-web-identity | 3.972.86 | Apache-2.0 |
| @aws-sdk/middleware-sdk-s3 | 3.972.85 | Apache-2.0 |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 |
| @aws-sdk/signature-v4-multi-region | 3.996.51 | Apache-2.0 |
| @aws-sdk/token-providers | 3.1161.0 | Apache-2.0 |
| @aws-sdk/types | 3.975.0 | Apache-2.0 |
| @aws-sdk/xml-builder | 3.972.42 | Apache-2.0 |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 |
| bowser | 2.15.0 | MIT |
| @smithy/core | 3.38.1 | Apache-2.0 |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 |
| @smithy/fetch-http-handler | 5.8.0 | Apache-2.0 |
| @smithy/node-http-handler | 4.14.1 | Apache-2.0 |
| @smithy/signature-v4 | 5.7.5 | Apache-2.0 |
| @smithy/types | 4.19.0 | Apache-2.0 |
| nodemailer | 6.9.2 | MIT |
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
| tslib | 2.9.1 | 0BSD |
| xtend | 4.0.2 | MIT |

All licences are MIT, ISC, Apache-2.0 or 0BSD. (pg-native is pg's optional native binding and is not installed.)

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Instrument Serif | instrument-serif.woff2 | SIL Open Font License 1.1 |
| Inter Tight | inter-tight.woff2 | SIL Open Font License 1.1 |
| JetBrains Mono | jetbrains-mono.woff2 | SIL Open Font License 1.1 |

The fonts are served from the app itself at `/assets/fonts/`.
